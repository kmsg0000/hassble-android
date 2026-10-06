from pathlib import Path

p = Path('app/src/main/java/dev/eigger/hassble/service/BleGatewayService.kt')
s = p.read_text()

# 1) Track full gateway restart separately from BLE-only reset.
marker = '    private val bleResetInProgress = java.util.concurrent.atomic.AtomicBoolean(false)\n'
if marker in s and 'gatewayRestartInProgress' not in s:
    s = s.replace(marker, marker + '    private val gatewayRestartInProgress = java.util.concurrent.atomic.AtomicBoolean(false)\n', 1)

# 2) Extend the service-level HA command collector.
old = '''                    if (kind == "command" && uid == resetBleUniqueId() && action == "press") resetBle("HA button")
'''
new = '''                    if (kind == "command" && action == "press") {
                        when (uid) {
                            resetBleUniqueId() -> resetBle("HA button")
                            restartGatewayUniqueId() -> restartGatewayPipeline("HA button")
                        }
                    }
'''
if old in s:
    s = s.replace(old, new, 1)
elif 'restartGatewayUniqueId() -> restartGatewayPipeline("HA button")' not in s:
    raise SystemExit('gateway command handler marker not found')

# 3) Declare a Home Assistant button on the phone device.
old = '''        client.declareEntity(EntityMsg(
            id = 0, uniqueId = resetBleUniqueId(), platform = "button",
            name = "Restart BLE", device = phoneDevice,
            icon = "mdi:restart", entityCategory = "config",
        ))
    }

    private fun resetBleUniqueId() = "${gatewayId()}_restart_ble"
'''
new = '''        client.declareEntity(EntityMsg(
            id = 0, uniqueId = resetBleUniqueId(), platform = "button",
            name = "Restart BLE", device = phoneDevice,
            icon = "mdi:restart", entityCategory = "config",
        ))
        client.declareEntity(EntityMsg(
            id = 0, uniqueId = restartGatewayUniqueId(), platform = "button",
            name = "Restart Gateway", device = phoneDevice,
            icon = "mdi:restart-alert", entityCategory = "config",
        ))
    }

    private fun resetBleUniqueId() = "${gatewayId()}_restart_ble"
    private fun restartGatewayUniqueId() = "${gatewayId()}_restart_gateway"
'''
if old in s:
    s = s.replace(old, new, 1)
elif 'private fun restartGatewayUniqueId()' not in s:
    raise SystemExit('gateway entity declaration marker not found')

# 4) Full gateway pipeline restart: tear down runtime + WebSocket + collectors, then rebuild
# from saved settings while keeping the Android foreground service alive. This is deliberately
# stronger than Restart BLE and is intended to mimic stop/start Gateway from the app UI closely
# enough for automation without losing the ability to receive the HA command itself.
insert_before = '''    private fun publishGatewayStates(client: HaWsClient?) {
'''
method = '''    private fun restartGatewayPipeline(reason: String) {
        scope.launch {
            if (!gatewayRestartInProgress.compareAndSet(false, true)) return@launch
            try {
                LiveEventLogger.log(LogType.LINK, "Gateway restart ($reason): tearing down runtime + WS pipeline")

                val repository = HassSettingsRepository(applicationContext)
                val haUrl = repository.haUrl.first()
                val token = repository.haToken.first()
                val refreshToken = repository.haRefreshToken.first().ifBlank { null }
                val gitUrl = repository.gitUrl.first()
                val gitToken = repository.gitToken.first()

                if (haUrl.isBlank() || haUrl == "https://" || token.isBlank()) {
                    LiveEventLogger.log(LogType.LINK, "[Error] Gateway restart aborted: saved HA settings are incomplete")
                    return@launch
                }

                configJob?.cancel()
                configJob = null
                settingsJob?.cancel()
                settingsJob = null
                heartbeatJob?.cancel()
                heartbeatJob = null

                val oldRuntime = runtime
                runtime = null
                oldRuntime?.stop()
                BleScanHealth.reset()

                // Cancel the old WS state/event collectors before closing the socket. Do this from a
                // service-scope child so cancelling wsStateJob does not cancel this restart coroutine.
                wsStateJob?.cancel()
                wsStateJob = null
                val oldWs = ws
                ws = null
                oldWs?.close()

                _deviceLinkStatuses.value = emptyList()
                _discoveredAdvInstances.value = emptyList()
                _sensorLastValues.value = emptyList()
                _advertisingDeviceIds.value = emptySet()
                lastSentLinkConnected.clear()
                _serviceConnectionState.value = ConnectionState.Disconnected
                _connectionIssue.value = ConnectionIssue.None

                currentGitUrl = gitUrl
                currentGitToken = gitToken
                delay(GATEWAY_RESTART_QUIET_MS)

                LiveEventLogger.log(LogType.LINK, "Gateway restart ($reason): rebuilding WS + BLE pipeline")
                startPipeline(haUrl, token, refreshToken)
            } finally {
                delay(1_000)
                gatewayRestartInProgress.set(false)
            }
        }
    }

'''
if 'private fun restartGatewayPipeline(reason: String)' not in s:
    if insert_before not in s:
        raise SystemExit('publishGatewayStates marker not found')
    s = s.replace(insert_before, method + insert_before, 1)

# 5) Quiet period between teardown and rebuild.
const_marker = '        private const val BLE_RESET_QUIET_MS = 1_500L\n'
const_decl = '        private const val GATEWAY_RESTART_QUIET_MS = 1_500L\n'
if const_marker in s and const_decl not in s:
    s = s.replace(const_marker, const_marker + const_decl, 1)
elif const_decl not in s:
    raise SystemExit('BLE reset constant marker not found')

p.write_text(s)
