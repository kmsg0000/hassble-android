package dev.eigger.hassble.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import dev.eigger.hassble.service.LiveEventLogger
import dev.eigger.hassble.service.LogType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import dev.eigger.hassble.config.DeviceConfig
import dev.eigger.hassble.config.SourceField

/**
 * Independent native BluetoothLeScanner lane for parking diagnostics.
 * Hardware manufacturer ID filter remains active for locked-screen delivery.
 * Never claims a packet is a parking position until the normal decoder verifies it.
 */
object ParkingNativeProbe {
    private fun ByteArray.toHex(): String = joinToString("") { "%02X".format(it.toInt() and 0xFF) }
    private var current: ScanCallback? = null
    private var pendingScan: PendingIntent? = null
    @Volatile private var pendingHandler: ((ScanResult) -> Unit)? = null
    fun dispatchPending(intent: Intent) {
        val error = intent.getIntExtra(android.bluetooth.le.BluetoothLeScanner.EXTRA_ERROR_CODE, 0)
        if (error != 0) LiveEventLogger.log(LogType.LINK, "Parking pending scan error=$error")
        @Suppress("DEPRECATION")
        val results = intent.getParcelableArrayListExtra<ScanResult>(android.bluetooth.le.BluetoothLeScanner.EXTRA_LIST_SCAN_RESULT).orEmpty()
        if (results.isNotEmpty()) LiveEventLogger.log(LogType.LINK, "Parking PendingIntent: delivered ${results.size} result(s)")
        results.forEach { pendingHandler?.invoke(it) }
    }
    private var activeScanner: android.bluetooth.le.BluetoothLeScanner? = null
    private var generation = 0
    @Synchronized
    @SuppressLint("MissingPermission")
    fun start(context: Context, scope: CoroutineScope, device: DeviceConfig, onReading: (RawReading) -> Unit) {
        val manufacturerId = device.match?.manufacturerId
        val bt = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN)
            != PackageManager.PERMISSION_GRANTED) return
        val scan = bt.bluetoothLeScanner ?: return
        current?.let { old -> runCatching { activeScanner?.stopScan(old) } }
        pendingScan?.let { old -> runCatching { activeScanner?.stopScan(old) }; old.cancel() }
        pendingScan = null
        generation++
        val mine = generation
        var seen = 0
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (mine != generation) return
                val rec = result.scanRecord ?: return
                val match = device.match ?: return
                val address = result.device.address
                val manufacturer = rec.manufacturerSpecificData
                val name = if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT)
                    == PackageManager.PERMISSION_GRANTED) runCatching { result.device.name ?: "" }.getOrDefault("") else ""
                val serviceData = rec.serviceData.orEmpty()
                val uuids = rec.serviceUuids.orEmpty()
                val matches = AdvertisementMatcher.matches(
                    match, address, name,
                    hasServiceUuid = { requested ->
                        val q = requested.uppercase()
                        serviceData.keys.any { it.uuid.toString().uppercase().contains(q) } ||
                            uuids.any { it.uuid.toString().uppercase().contains(q) }
                    },
                    manufacturerPayload = { id -> manufacturer?.get(id)?.takeIf { it.isNotEmpty() } },
                )
                if (seen++ < 12) LiveEventLogger.log(LogType.LINK,
                    "Parking native scanner: raw callback matched=$matches, rssi=${result.rssi}")
                if (!matches) return
                val mfrHex = manufacturerId?.let { manufacturer?.get(it)?.toHex() }
                val serviceHex = match.serviceDataUuid?.let { requested ->
                    serviceData.entries.firstOrNull {
                        it.key.uuid.toString().uppercase().contains(requested.uppercase())
                    }?.value?.toHex()
                }
                val fullHex = rec.bytes?.toHex()
                val primary = when (device.sensors.firstOrNull()?.sourceField ?: SourceField.raw) {
                    SourceField.manufacturer_data -> mfrHex
                    SourceField.service_data -> serviceHex
                    SourceField.raw -> fullHex
                }
                if (primary.isNullOrBlank()) return
                LiveEventLogger.log(LogType.LINK, "Parking native scanner: decoded candidate forwarded to HA pipeline")
                scope.launch {
                    onReading(RawReading(
                        deviceId = device.id,
                        source = "advertisement",
                        rawHex = primary,
                        macAddress = address,
                        deviceName = name.takeIf { it.isNotEmpty() },
                        manufacturerHex = mfrHex,
                        serviceDataHex = serviceHex,
                        fullScanHex = fullHex,
                        isConnectable = result.isConnectable,
                    ))
                }
            }
            override fun onScanFailed(errorCode: Int) {
                LiveEventLogger.log(LogType.LINK, "Parking native scanner: onScanFailed=$errorCode")
            }
        }
        val filters = if (manufacturerId != null) listOf(
            ScanFilter.Builder().setManufacturerData(manufacturerId, byteArrayOf()).build()
        ) else emptyList()
        if (filters.isEmpty()) {
            LiveEventLogger.log(LogType.LINK,
                "Parking native scanner: no manufacturer ID configured; screen-off probe unavailable")
            return
        }
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setLegacy(false)
            .build()
        val intent = Intent(context, ParkingScanReceiver::class.java).setAction("dev.eigger.hassble.PARKING_SCAN_RESULT")
        val pi = PendingIntent.getBroadcast(context, 861, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        try {
            pendingHandler = { result -> callback.onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, result) }
            val code = scan.startScan(filters, settings, pi)
            if (code != 0) throw IllegalStateException("PendingIntent scan start code=$code")
            pendingScan = pi
            LiveEventLogger.log(LogType.LINK, "Parking PendingIntent scan active (22s), manufacturer=$manufacturerId")
            scan.startScan(filters, settings, callback)
            current = callback
            activeScanner = scan
            LiveEventLogger.log(LogType.LINK, "Parking native scanner: started independent 22s scan mfrId=$manufacturerId")
        } catch (e: Exception) {
            LiveEventLogger.log(LogType.LINK, "Parking native scanner: start failure=${e.message}")
            return
        }
        scope.launch {
            delay(22_000L)
            synchronized(this@ParkingNativeProbe) {
                if (generation == mine) {
                    runCatching { scan.stopScan(callback) }
                    pendingScan?.let { runCatching { scan.stopScan(it) }; it.cancel() }
                    pendingScan = null
                    pendingHandler = null
                    current = null
                    activeScanner = null
                    LiveEventLogger.log(LogType.LINK, "Parking native scanner: stopped, callbacks=$seen")
                }
            }
        }
    }
}

class ParkingScanReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        ParkingNativeProbe.dispatchPending(intent)
    }
}
