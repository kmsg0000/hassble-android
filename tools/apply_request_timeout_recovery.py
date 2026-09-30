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

        // HA automations may press the request button repeatedly. Do not let duplicate presses reset
        // the recovery timer or stack overlapping advertise stop/start cycles. One in-flight request
        // owns the whole recovery sequence until a response arrives or the sequence finishes.
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
            // Stage 1: keep the healthy path untouched for a full response window.
            delay(REQUEST_RESPONSE_TIMEOUT_MS)
            if (!isActive) return@launch

            // Stage 2: recover only the request/advertising flow first.
            LiveEventLogger.log(LogType.LINK,
                "[Warning] device=${d.id}: response timeout — stop advertisement, wait, then retry once")
            advertiser?.stop(d.id, AdvertiseStopReason.Manual)
            delay(REQUEST_RETRY_GAP_MS)
            if (!isActive || blePaused || stopped) return@launch
            startAdvertise(d)

            delay(REQUEST_RESPONSE_TIMEOUT_MS)
            if (!isActive) return@launch

            // Stage 3: only if the clean advertise retry also fails, rebuild the BLE scan session.
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
''', '''        private const val REQUEST_RESPONSE_TIMEOUT_MS = 5_000L
        private const val REQUEST_RETRY_GAP_MS = 1_500L
        private const val REQUEST_SCAN_READY_TIMEOUT_MS = 5_000L
''')

p.write_text(s)
