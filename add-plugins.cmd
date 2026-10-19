@echo off
rem Wrapper for add-plugins.ps1. The DSH terminal (sandboxed shell) refuses
rem unsigned .ps1 files under RemoteSigned because its authorization manager
rem cannot run, so the policy must be bypassed for this invocation.
rem The plugin set is discovered from the top-level dsh-* directories by add-plugins.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0add-plugins.ps1" %*
exit /b %ERRORLEVEL%
