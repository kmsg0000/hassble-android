package dev.eigger.hassble.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import dev.eigger.hassble.config.HassSettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

private const val TAG = "HassBleBootReceiver"

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED) return
        // Keep the receiver alive while DataStore settings are read.
        val pending = goAsync()
        val appContext = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val repository = HassSettingsRepository(appContext)
                if (!repository.startOnBoot.first()) {
                    Log.i(TAG, "Start on boot is disabled")
                    return@launch
                }
                val url = repository.haUrl.first()
                val token = repository.haToken.first()
                val refreshToken = repository.haRefreshToken.first()
                val gitUrl = repository.gitUrl.first()
                val gitToken = repository.gitToken.first()
                if (url.isBlank() || token.isBlank() || gitUrl.isBlank()) {
                    Log.w(TAG, "Auto-start skipped: missing HA or Git settings")
                    return@launch
                }
                Log.i(TAG, "Boot completed: starting foreground gateway service")
                BleGatewayService.start(appContext, url, token, refreshToken, gitUrl, gitToken)
            } catch (e: Exception) {
                Log.e(TAG, "Boot auto-start failed: ${e.javaClass.simpleName}: ${e.message}", e)
            } finally {
                pending.finish()
            }
        }
    }
}
