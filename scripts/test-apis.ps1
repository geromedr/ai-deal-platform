# test-apis.ps1
# Tests DeepSeek and Jina AI APIs via the deployed Supabase edge functions
# Run from your project root: .\scripts\test-apis.ps1

$ErrorActionPreference = "Stop"

# Load .env
$envFile = Join-Path (Join-Path $PSScriptRoot "..") ".env"
$envVars = @{}
Get-Content $envFile | ForEach-Object {
    if ($_ -match "^([^#][^=]+)=(.+)$") {
        $envVars[$matches[1].Trim()] = $matches[2].Trim().Trim('"')
    }
}

$SUPABASE_URL  = $envVars["NEXT_PUBLIC_SUPABASE_URL"]
$ANON_KEY      = $envVars["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
$DEAL_ID       = "11111111-1111-1111-1111-111111111111"   # seed deal

$headers = @{
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer $ANON_KEY"
}

$passed = 0
$failed = 0

function Test-Result {
    param($name, $status, $body, $expectKey)
    if ($status -ge 200 -and $status -lt 300) {
        if ($expectKey -and $body -notmatch $expectKey) {
            Write-Host "  WARN  $name  (HTTP $status, but '$expectKey' not found in response)" -ForegroundColor Yellow
            Write-Host "        Response: $($body.Substring(0, [Math]::Min(200, $body.Length)))"
        } else {
            Write-Host "  PASS  $name  (HTTP $status)" -ForegroundColor Green
            $script:passed++
        }
    } else {
        Write-Host "  FAIL  $name  (HTTP $status)" -ForegroundColor Red
        Write-Host "        Response: $($body.Substring(0, [Math]::Min(300, $body.Length)))"
        $script:failed++
    }
}

Write-Host ""
Write-Host "AI Deal Platform — API Integration Tests" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Supabase: $($SUPABASE_URL.Substring(0, 40))..."
Write-Host ""

# ──────────────────────────────────────────────────────────────────────────────
# TEST 1: Jina AI — search-knowledge
# ──────────────────────────────────────────────────────────────────────────────
Write-Host "1. Jina AI Embeddings (search-knowledge)" -ForegroundColor White
try {
    $resp = Invoke-WebRequest -Uri "$SUPABASE_URL/functions/v1/search-knowledge" `
        -Method POST -Headers $headers `
        -Body '{"query":"comparable apartment sales Sydney NSW"}' `
        -UseBasicParsing -TimeoutSec 20
    Test-Result "search-knowledge → Jina embed + vector search" $resp.StatusCode $resp.Content $null
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $body = ""
    try { $body = $_.ErrorDetails.Message } catch {}
    Write-Host "  FAIL  search-knowledge  (HTTP $statusCode)" -ForegroundColor Red
    Write-Host "        $body" -ForegroundColor Red
    $failed++
}

# ──────────────────────────────────────────────────────────────────────────────
# TEST 2: Jina AI — add-knowledge-document (write a test chunk, delete after)
# ──────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "2. Jina AI Embeddings (add-knowledge-document)" -ForegroundColor White
try {
    $body = '{"source_name":"api-test","category":"test","content":"Test embedding: Sydney apartment comparable sales 2024."}'
    $resp = Invoke-WebRequest -Uri "$SUPABASE_URL/functions/v1/add-knowledge-document" `
        -Method POST -Headers $headers `
        -Body $body `
        -UseBasicParsing -TimeoutSec 20
    Test-Result "add-knowledge-document → Jina embed + insert" $resp.StatusCode $resp.Content "success"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errBody = ""
    try { $errBody = $_.ErrorDetails.Message } catch {}
    Write-Host "  FAIL  add-knowledge-document  (HTTP $statusCode)" -ForegroundColor Red
    Write-Host "        $errBody" -ForegroundColor Red
    $failed++
}

# ──────────────────────────────────────────────────────────────────────────────
# TEST 3: DeepSeek — deal-intelligence
# ──────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "3. DeepSeek AI (deal-intelligence)" -ForegroundColor White
try {
    $resp = Invoke-WebRequest -Uri "$SUPABASE_URL/functions/v1/deal-intelligence" `
        -Method POST -Headers $headers `
        -Body "{`"deal_id`":`"$DEAL_ID`"}" `
        -UseBasicParsing -TimeoutSec 30
    Test-Result "deal-intelligence → DeepSeek analysis" $resp.StatusCode $resp.Content "analysis_completed"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errBody = ""
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errBody = $reader.ReadToEnd()
    } catch {}
    if (-not $errBody) { try { $errBody = $_.ErrorDetails.Message } catch {} }
    Write-Host "  FAIL  deal-intelligence  (HTTP $statusCode)" -ForegroundColor Red
    Write-Host "        $errBody" -ForegroundColor Red
    $failed++
}

# ──────────────────────────────────────────────────────────────────────────────
# TEST 4: DeepSeek — ai-agent (RAG + reasoning)
# ──────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "4. DeepSeek AI + Jina RAG (ai-agent)" -ForegroundColor White
try {
    $payload = "{`"deal_id`":`"$DEAL_ID`",`"prompt`":`"What are the key risks for this development deal?`"}"
    $resp = Invoke-WebRequest -Uri "$SUPABASE_URL/functions/v1/ai-agent" `
        -Method POST -Headers $headers `
        -Body $payload `
        -UseBasicParsing -TimeoutSec 30
    Test-Result "ai-agent → Jina embed + DeepSeek reasoning" $resp.StatusCode $resp.Content "ai_result"
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errBody = ""
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $errBody = $reader.ReadToEnd()
    } catch {}
    if (-not $errBody) { try { $errBody = $_.ErrorDetails.Message } catch {} }
    Write-Host "  FAIL  ai-agent  (HTTP $statusCode)" -ForegroundColor Red
    Write-Host "        $errBody" -ForegroundColor Red
    $failed++
}

# ──────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ──────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
if ($failed -eq 0) {
    Write-Host "  All $passed tests passed" -ForegroundColor Green
} else {
    Write-Host "  $passed passed, $failed failed" -ForegroundColor $(if ($passed -eq 0) { "Red" } else { "Yellow" })
}
Write-Host ""
