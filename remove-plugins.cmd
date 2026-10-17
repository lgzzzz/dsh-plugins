@echo off
rem Wrapper for remove-plugins.ps1. The DSH terminal (sandboxed shell) refuses
rem unsigned .ps1 files under RemoteSigned because its authorization manager
rem cannot run, so the policy must be bypassed for this invocation.
rem The plugin list lives in remove-plugins.ps1 / remove-plugins.sh, not here.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0remove-plugins.ps1" %*
exit /b %ERRORLEVEL%
