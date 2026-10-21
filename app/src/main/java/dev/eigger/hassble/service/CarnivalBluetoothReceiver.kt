package dev.eigger.hassble.service

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Carnival Hybrid classic Bluetooth link monitor.
 * Tracks a verified CONNECTED -> DISCONNECTED pair, never reacts to unrelated devices.
 * The application foreground service also registers this receiver dynamically,
 * while the manifest registration gives Android a chance to deliver it after process death.
 */
class CarnivalBluetoothReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != BluetoothDevice.ACTION_ACL_CONNECTED &&
            action != BluetoothDevice.ACTION_ACL_DISCONNECTED) return
        val app = context.applicationContext
        if (Build.VERSION.SDK_INT >= 31 &&
            ContextCompat.checkSelfPermission(app, Manifest.permission.BLUETOOTH_CONNECT)
                != PackageManager.PERMISSION_GRANTED) {
            LiveEventLogger.log(LogType.LINK, "Carnival BT: BLUETOOTH_CONNECT permission missing")
            return
        }
        @Suppress("DEPRECATION")
        val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }
        @Suppress("MissingPermission")
        val name = runCatching { device?.name }.getOrNull()
        if (name != "Carnival Hybrid") return
        val prefs = app.getSharedPreferences("carnival_link_monitor", Context.MODE_PRIVATE)
        val address = runCatching { device?.address.orEmpty() }.getOrDefault("")
        if (action == BluetoothDevice.ACTION_ACL_CONNECTED) {
            prefs.edit().putBoolean("connected", true).putString("address", address).apply()
            LiveEventLogger.log(LogType.LINK, "Carnival Hybrid: classic Bluetooth connected")
            return
        }
        if (!prefs.getBoolean("connected", false)) return
        if (prefs.getString("address", address) != address) return
        prefs.edit().putBoolean("connected", false).apply()
        val now = System.currentTimeMillis()
        val recover = app.getSharedPreferences("parking_service_recovery", Context.MODE_PRIVATE)
        val last = recover.getLong("carnival_restarted_at", 0L)
        if (now - last < 15_000L) return
        recover.edit().putLong("carnival_restarted_at", now)
            .putBoolean("retry_pending", true)
            .putBoolean("carnival_second_request", true).apply()
        LiveEventLogger.log(LogType.LINK, "Carnival Hybrid: disconnect -> direct manual-style service Stop/Start")
        val restart = Intent(app, GatewayProcessRestartService::class.java)
            .setAction(GatewayProcessRestartService.ACTION_MANUAL_STOP_START)
        runCatching { ContextCompat.startForegroundService(app, restart) }
            .onFailure { e ->
                LiveEventLogger.log(LogType.LINK, "[Error] Carnival direct restart blocked: ${e.message}")
            }
    }
}
