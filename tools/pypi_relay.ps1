# Local PyPI relay for NTLM proxy environments
# pip --(localhost)--> this script --(Windows logon credentials)--> proxy --> pypi
param([int]$Port = 18081, [string]$Upstream = "")
$logFile = Join-Path $env:TEMP "ls3_pypi_relay.log"
Remove-Item $logFile -ErrorAction SilentlyContinue
function Out-Log([string]$s) { Write-Host $s; Add-Content -Path $logFile -Value $s }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$prefix = "http://localhost:$Port/"
$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch { Out-Log ("[ERROR] cannot listen " + $prefix + " : " + $_.Exception.Message); Start-Sleep 5; exit 1 }
$sync = [hashtable]::Synchronized(@{ Stop = $false; Ok = 0; Err = 0 })
$log  = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$worker = {
    param($listener, $sync, $log, $Port, $Upstream)
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if ($Upstream) { $px = New-Object Net.WebProxy($Upstream) } else { $px = [Net.WebRequest]::GetSystemWebProxy() }
    $px.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
    $self = "http://localhost:$Port"
    while ($listener.IsListening) {
        try { $ctx = $listener.GetContext() } catch { break }
        $res = $ctx.Response
        $path = $ctx.Request.Url.PathAndQuery
        try {
            $code = 404; $body = [byte[]]@(); $ctype = "application/octet-stream"
            if ($path -eq '/__stop') { $sync.Stop = $true; $code = 200; $body = [Text.Encoding]::ASCII.GetBytes('bye') }
            else {
                $url = $null; $rewrite = $false
                if ($path.StartsWith('/simple/')) { $url = 'https://pypi.org' + $path; $rewrite = $true }
                elseif ($path.StartsWith('/files/')) { $url = 'https://files.pythonhosted.org/' + $path.Substring(7) }
                if ($url) {
                    $wc = New-Object Net.WebClient
                    $wc.Proxy = $px
                    $wc.Headers.Add('Accept', 'text/html')
                    try {
                        $body = $wc.DownloadData($url); $code = 200
                        if ($rewrite) {
                            $t = [Text.Encoding]::UTF8.GetString($body)
                            $t = $t.Replace('https://files.pythonhosted.org/', $self + '/files/')
                            $body = [Text.Encoding]::UTF8.GetBytes($t)
                            $ctype = 'text/html; charset=utf-8'
                        }
                    } catch {
                        $e = $_.Exception
                        while ($e -and -not ($e -is [Net.WebException])) { $e = $e.InnerException }
                        if ($e -and $e.Response) { $code = [int]$e.Response.StatusCode } else { $code = 502 }
                        $body = [byte[]]@()
                        if ($code -ne 404) { $log.Enqueue("[NG] $code $url : " + $_.Exception.Message) }
                    } finally { $wc.Dispose() }
                }
            }
            $res.StatusCode = $code; $res.ContentType = $ctype; $res.ContentLength64 = $body.Length
            if ($body.Length -gt 0) { $res.OutputStream.Write($body, 0, $body.Length) }
            if ($code -eq 200) { $sync.Ok++ } elseif ($code -ne 404) { $sync.Err++ }
        } catch { $log.Enqueue("[ERR] $path : " + $_.Exception.Message) }
        finally { try { $res.Close() } catch {} }
    }
}
$pool = [runspacefactory]::CreateRunspacePool(1, 6); $pool.Open()
$jobs = @()
for ($i = 0; $i -lt 6; $i++) {
    $ps = [powershell]::Create(); $ps.RunspacePool = $pool
    [void]$ps.AddScript($worker).AddArgument($listener).AddArgument($sync).AddArgument($log).AddArgument($Port).AddArgument($Upstream)
    $jobs += @{ P = $ps; H = $ps.BeginInvoke() }
}
Out-Log ("[READY] " + $prefix)
while (-not $sync.Stop) {
    Start-Sleep -Milliseconds 500
    $m = $null
    while ($log.TryDequeue([ref]$m)) { Out-Log $m }
    $host.UI.RawUI.WindowTitle = "DefectTrace pypi relay  ok=" + $sync.Ok + "  ng=" + $sync.Err
}
Out-Log ("[STOP] ok=" + $sync.Ok + " ng=" + $sync.Err)
$listener.Stop(); $listener.Close()
foreach ($j in $jobs) { try { [void]$j.P.EndInvoke($j.H) } catch {}; $j.P.Dispose() }
$pool.Close()
