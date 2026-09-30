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
if old_fields not in s:
    raise SystemExit('request fields marker not found')
s = s.replace(old_fields, new_fields, 1)

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

        requestRecoveryJobs.remove(d.id)?.cancel()
        if (advertiser?.isAdvertising(d.id) == true) {
            advertiser.stop(d.id, AdvertiseStopReason.Manual)
        }

        LiveEventLogger.log(LogType.LINK,
            "device=${d.id}: request started normally; recovery will run only if no response arrives")
        startAdvertise(d)

        val job = scope.launch {
            delay(REQUEST_RESPONSE_TIMEOUT_MS)
            if (!isActive) return@launch

            LiveEventLogger.log(LogType.LINK,
                "[Warning] device=${d.id}: no response within ${REQUEST_RESPONSE_TIMEOUT_MS}ms — stopping stuck request and retrying")
            advertiser?.stop(d.id, AdvertiseStopReason.Manual)
            delay(REQUEST_RETRY_GAP_MS)
            if (!isActive || blePaused || stopped) return@launch
            startAdvertise(d)

            delay(REQUEST_RESPONSE_TIMEOUT_MS)
            if (!isActive) return@launch

            LiveEventLogger.log(LogType.LINK,
                "[Warning] device=${d.id}: retry also timed out — refreshing BLE scan and trying once more")
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

marker = '''            Source.advertisement -> {
                val mac = r.macAddress ?: return
                if (d.advertise?.stopOnResponse == true && advertiser?.isAdvertising(d.id) == true) {
                    advertiser.stop(d.id, AdvertiseStopReason.ResponseReceived)
                }
'''
replacement = '''            Source.advertisement -> {
                val mac = r.macAddress ?: return
                if (d.advertise?.stopOnResponse == true) {
                    requestRecoveryJobs.remove(d.id)?.cancel()
                    if (advertiser?.isAdvertising(d.id) == true) {
                        advertiser.stop(d.id, AdvertiseStopReason.ResponseReceived)
                    }
                    LiveEventLogger.log(LogType.LINK, "device=${d.id}: request response received — recovery cancelled")
                }
'''
if marker not in s:
    raise SystemExit('advertisement response marker not found')
s = s.replace(marker, replacement, 1)

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
s = s.replace('''        private const val REQUEST_SCAN_REFRESH_COOLDOWN_MS = 15_000L
        private const val REQUEST_SCAN_READY_TIMEOUT_MS = 5_000L
''', '''        private const val REQUEST_RESPONSE_TIMEOUT_MS = 3_000L
        private const val REQUEST_RETRY_GAP_MS = 750L
        private const val REQUEST_SCAN_READY_TIMEOUT_MS = 5_000L
''')

p.write_text(s)
