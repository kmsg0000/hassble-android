package dev.eigger.hassble.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import dev.eigger.hassble.service.LiveEventLogger
import dev.eigger.hassble.service.LogType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Independent native BluetoothLeScanner lane for parking diagnostics.
 * Hardware manufacturer ID filter remains active for locked-screen delivery.
 * Never claims a packet is a parking position until the normal decoder verifies it.
 */
object ParkingNativeProbe {
    private var current: ScanCallback? = null
    private var activeScanner: android.bluetooth.le.BluetoothLeScanner? = null
    private var generation = 0
    @Synchronized
    @SuppressLint("MissingPermission")
    fun start(context: Context, scope: CoroutineScope, manufacturerId: Int?) {
        val bt = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN)
            != PackageManager.PERMISSION_GRANTED) return
        val scan = bt.bluetoothLeScanner ?: return
        current?.let { old -> runCatching { activeScanner?.stopScan(old) } }
        generation++
        val mine = generation
        var seen = 0
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                if (mine != generation) return
                if (seen++ < 12) {
                    val rec = result.scanRecord
                    val mfr = rec?.manufacturerSpecificData
                    val ids = if (mfr != null) (0 until mfr.size()).map { mfr.keyAt(it) } else emptyList()
                    LiveEventLogger.log(LogType.LINK,
                        "Parking native scanner: callback mfrIds=$ids, addr=${result.device.address}, rssi=${result.rssi}")
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
        try {
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
                    current = null
                    activeScanner = null
                    LiveEventLogger.log(LogType.LINK, "Parking native scanner: stopped, callbacks=$seen")
                }
            }
        }
    }
}
