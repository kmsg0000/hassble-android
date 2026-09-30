from pathlib import Path

p = Path('app/src/main/java/dev/eigger/hassble/ble/BleRuntime.kt')
s = p.read_text()

old_fields = '''    // Request/response advertisement profiles (for example MyTown parking) can hit an Android BLE
    // scanner state where the scan Flow is still alive but the expected response is no longer delivered.
    // A short, rate-limited scan refresh before the request mirrors the manual gateway restart that
    // recovers the device, without restarting the whole foreground service.
    private val requestScanRefreshJobs = java.util.concurrent.ConcurrentHashMap<String, Job>()
    private val lastRequestScanRefreshMs = java.util.concurrent.ConcurrentHashMap<String, Long>()
'''
new_fields = '''    // Request/response advertisement recovery. Do not disturb a healthy scanner up front.
    // Only recover when a request receives no matching response within the timeout.
    private val requestRecoveryJobs = java.util.concurrent.ConcurrentHashMap<String, Job>()
'''
if old_fields in s:
    s = s.replace(old_fields, new_fields, 1)
elif 'private val requestRecoveryJobs = java.util.concurrent.ConcurrentHashMap<String, Job>()' not in s:
    raise SystemExit('request recovery fields not found')

start = s.index('    private fun startAdvertiseForRequest(d: DeviceConfig) {')
end = s.index('    private fun startAdvertise(d: DeviceConfig) {', start)
new_method = '''    private fun startAdvertiseForRequest(d: DeviceConfig) {
        if (blePaused) {
            LiveEventLogger.log(LogType.LINK, "device=${d.id}: advertise request ignored while BLE gateway is paused")
            return
        }
        val needsResponse = d.source == Source.advertisement && d.advertise?.stopOnResponse == true
        if (!needsResponse) {
            startAdvertise(d)
            return
        }

        // HA may press repeatedly while its automation waits. Keep one request/recovery sequence alive
        // instead of resetting the timer and stacking advertise stop/start operations.
        requestRecoveryJobs[d.id]?.takeIf { it.isActive }?.let {
            LiveEventLogger.log(LogType.LINK,
                "device=${d.id}: duplicate request ignored while recovery sequence is active")
            return
        }

        if (advertiser?.isAdvertising(d.id) == true) {
            advertiser.stop(d.id, AdvertiseStopReason.Manual)
        }

        LiveEventLogger.log(LogType.LINK,
            "device=${d.id}: request started; waiting ${REQUEST_RESPONSE_TIMEOUT_MS}ms before recovery")
        startAdvertise(d)

        val job = scope.launch {
            // Stage 1: normal request. Healthy scanners are left alone.
            delay(REQUEST_RESPONSE_TIMEOUT_MS)
            if (!isActive) return@launch

            // Stage 2: stop the possibly stuck advertise request, give Android time to release it,
            // then retry without touching the scan session.
            LiveEventLogger.log(LogType.LINK,
                "[Warning] device=${d.id}: response timeout — stop advertisement and retry")
            advertiser?.stop(d.id, AdvertiseStopReason.Manual)
            delay(REQUEST_RETRY_GAP_MS)
            if (!isActive || blePaused || stopped) return@launch
            startAdvertise(d)

            delay(REQUEST_RESPONSE_TIMEOUT_MS)
            if (!isActive) return@launch

            // Stage 3: only after the clean advertise retry fails do we rebuild the BLE scanner.
            LiveEventLogger.log(LogType.LINK,
                "[Warning] device=${d.id}: retry timed out — refreshing BLE scan before final request")
            advertiser?.stop(d.id, AdvertiseStopReason.Manual)

            val beforeSession = BleScanHealth.state.value.sessionCount
            scanLifecycleMutex.withLock {
                scanJob?.cancelAndJoin()
                scanJob = null
                scanner.stop()
                if (stopped || blePaused) return@withLock
                launchScan()
            }

            withTimeoutOrNull(REQUEST_SCAN_READY_TIMEOUT_MS) {
                BleScanHealth.state.first { health ->
                    health.scanning && health.sessionCount > beforeSession
                }
            }
            delay(REQUEST_RETRY_GAP_MS)
            if (!isActive || blePaused || stopped) return@launch
            startAdvertise(d)
            LiveEventLogger.log(LogType.LINK,
                "device=${d.id}: final request sent after BLE scan refresh")
        }
        requestRecoveryJobs[d.id] = job
        job.invokeOnCompletion { requestRecoveryJobs.remove(d.id, job) }
    }

'''
s = s[:start] + new_method + s[end:]

old_response = '''            Source.advertisement -> {
                val mac = r.macAddress ?: return
                if (d.advertise?.stopOnResponse == true && advertiser?.isAdvertising(d.id) == true) {
                    advertiser.stop(d.id, AdvertiseStopReason.ResponseReceived)
                }
'''
new_response = '''            Source.advertisement -> {
                val mac = r.macAddress ?: return
                if (d.advertise?.stopOnResponse == true) {
                    requestRecoveryJobs.remove(d.id)?.cancel()
                    if (advertiser?.isAdvertising(d.id) == true) {
                        advertiser.stop(d.id, AdvertiseStopReason.ResponseReceived)
                    }
                    LiveEventLogger.log(LogType.LINK, "device=${d.id}: request response received — recovery cancelled")
                }
'''
if old_response in s:
    s = s.replace(old_response, new_response, 1)
elif 'request response received — recovery cancelled' not in s:
    raise SystemExit('advertisement response handler not found')

s = s.replace('''            requestScanRefreshJobs.values.forEach { it.cancel() }
            requestScanRefreshJobs.clear()
''', '''            requestRecoveryJobs.values.forEach { it.cancel() }
            requestRecoveryJobs.clear()
''')
s = s.replace('''        requestScanRefreshJobs.values.forEach { it.cancel() }
        requestScanRefreshJobs.clear()
        lastRequestScanRefreshMs.clear()
''', '''        requestRecoveryJobs.values.forEach { it.cancel() }
        requestRecoveryJobs.clear()
''')

# Fast recovery tuning for a garage exit that can take less than 30 seconds.
fast_constants = '''        private const val REQUEST_RESPONSE_TIMEOUT_MS = 2_000L
        private const val REQUEST_RETRY_GAP_MS = 500L
        private const val REQUEST_SCAN_READY_TIMEOUT_MS = 5_000L
'''
for previous in (
    '''        private const val REQUEST_SCAN_REFRESH_COOLDOWN_MS = 15_000L
        private const val REQUEST_SCAN_READY_TIMEOUT_MS = 5_000L
''',
    '''        private const val REQUEST_RESPONSE_TIMEOUT_MS = 3_000L
        private const val REQUEST_RETRY_GAP_MS = 750L
        private const val REQUEST_SCAN_READY_TIMEOUT_MS = 5_000L
''',
    '''        private const val REQUEST_RESPONSE_TIMEOUT_MS = 5_000L
        private const val REQUEST_RETRY_GAP_MS = 1_500L
        private const val REQUEST_SCAN_READY_TIMEOUT_MS = 5_000L
''',
):
    if previous in s:
        s = s.replace(previous, fast_constants, 1)
        break
else:
    if fast_constants not in s:
        raise SystemExit('request recovery constants not found')

p.write_text(s)
