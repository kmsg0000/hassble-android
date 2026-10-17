package dev.eigger.hassble.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Best-effort fallback for Samsung task removal. A user force-stop still blocks
 * alarms and background foreground-service starts may be denied on Android 12+.
 */
class GatewayRecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_RECOVER) return
        if (BleGatewayService.isServiceRunning.value) {
            Log.i(TAG, "Gateway still running; skipping recovery")
            return
        }
        try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, BleGatewayService::class.java)
                    .setAction(BleGatewayService.ACTION_RESTART_FROM_SAVED),
            )
            Log.i(TAG, "Requested saved-settings gateway recovery")
        } catch (e: Exception) {
            Log.w(TAG, "Android blocked recovery; open HassBle to restart: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "HassBleRecovery"
        const val ACTION_RECOVER = "dev.eigger.hassble.RECOVER_GATEWAY"
    }
}
