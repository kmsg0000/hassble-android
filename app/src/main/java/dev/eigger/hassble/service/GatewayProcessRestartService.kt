package dev.eigger.hassble.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Restart helper that runs in a separate Android process.
 *
 * The main process can be killed completely so Android's BLE stack objects are
 * recreated from scratch. This helper survives that kill, waits briefly, then
 * starts a new BleGatewayService process from persisted settings.
 */
class GatewayProcessRestartService : Service() {

    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        val mgr = getSystemService(NotificationManager::class.java)
        if (mgr.getNotificationChannel(CHANNEL_ID) == null) {
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "HassBle Restart",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("HassBle")
            .setContentText("Gateway restarting…")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()

        startForeground(NOTIF_ID, notification)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        LiveEventLogger.log(LogType.LINK, "Restart helper: waiting for main process to exit")

        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({
            LiveEventLogger.log(LogType.LINK, "Restart helper: starting fresh gateway process")
            val restartIntent = Intent(this, BleGatewayService::class.java)
                .setAction(BleGatewayService.ACTION_RESTART_FROM_SAVED)

            runCatching { ContextCompat.startForegroundService(this, restartIntent) }
                .onFailure { e ->
                    LiveEventLogger.log(
                        LogType.LINK,
                        "[Error] Restart helper failed to start gateway: ${e.message}",
                    )
                }

            stopSelf()
        }, RESTART_DELAY_MS)

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "ble_gateway_restart"
        private const val NOTIF_ID = 3
        private const val RESTART_DELAY_MS = 2200L
    }
}
