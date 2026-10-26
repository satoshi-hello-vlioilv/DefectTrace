@echo off
setlocal
title DefectTrace
cd /d "%~dp0"

rem ============================================================
rem  DefectTrace launcher
rem  - uses installed Python directly (no venv)
rem  - if flask is missing: pip install --user via localhost relay
rem    (relay -> NTLM proxy -> PyPI), only once
rem ============================================================

set "UPPROXY=http://NlmLbAks01:8080"
set "RPORT=18081"
set "RELAY=http://localhost:%RPORT%"
set "RLOG=%TEMP%\ls3_pypi_relay.log"
set "NO_PROXY=localhost,127.0.0.1"
set "PYTHONDONTWRITEBYTECODE=1"

set "PY="
python --version >nul 2>&1
if not errorlevel 1 set "PY=python"
if defined PY goto PY_OK
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY goto NOPY
:PY_OK
for /f "delims=" %%A in ('%PY% --version') do echo [OK] %%A

%PY% -c "import flask" >nul 2>&1
if not errorlevel 1 goto PKG_OK

echo [INFO] flask not found. Installing (first time only)...
set "HTTPS_PROXY="
set "HTTP_PROXY="
start "DefectTrace pypi relay" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\pypi_relay.ps1" -Port %RPORT% -Upstream "%UPPROXY%"
set "N=0"
:WAIT
timeout /t 2 /nobreak >nul
curl.exe -s -f -o nul --noproxy "*" --max-time 30 %RELAY%/simple/flask/
if not errorlevel 1 goto RELAY_OK
set /a N+=1
if %N% LSS 15 goto WAIT
call :STOPRELAY
goto RELAY_NG

:RELAY_OK
%PY% -m pip install --user --disable-pip-version-check --index-url %RELAY%/simple/ --trusted-host localhost flask pillow
set "RC=%ERRORLEVEL%"
call :STOPRELAY
if not "%RC%"=="0" goto PIPNG
%PY% -c "import flask" >nul 2>&1
if errorlevel 1 goto PIPNG

:PKG_OK
%PY% -c "import PIL" >nul 2>&1
if errorlevel 1 echo [WARN] Pillow not found. Thumbnails use full-size images.
echo [OK] flask
echo.
echo DefectTrace : http://127.0.0.1:5050/
echo Close this window to stop DefectTrace.
echo.
%PY% "%~dp0app.py"
echo.
echo [INFO] server stopped.
goto END

:NOPY
echo [ERROR] Python not found in PATH.
goto END

:RELAY_NG
echo [NG] relay could not reach PyPI
if exist "%RLOG%" type "%RLOG%"
echo Manual install: python -m pip install --user flask pillow
goto END

:PIPNG
echo [ERROR] pip install failed. Relay log: %RLOG%
goto END

:STOPRELAY
curl.exe -s -o nul --noproxy "*" --max-time 5 %RELAY%/__stop
goto :eof

:END
echo.
pause
