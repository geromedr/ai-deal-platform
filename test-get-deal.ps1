$EnvFilePath = Join-Path $PSScriptRoot ".env"

if (Test-Path $EnvFilePath) {
    Get-Content $EnvFilePath | ForEach-Object {
        $Line = $_.Trim()

        if ([string]::IsNullOrWhiteSpace($Line) -or $Line.StartsWith("#")) {
            return
        }

        $Parts = $Line -split "=", 2

        if ($Parts.Count -ne 2) {
            return
        }

        $Key = $Parts[0].Trim()
        $Value = $Parts[1].Trim()

        if ([string]::IsNullOrWhiteSpace($Key)) {
            return
        }

        if (
            ($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
            ($Value.StartsWith("'") -and $Value.EndsWith("'"))
        ) {
            $Value = $Value.Substring(1, $Value.Length - 2)
        }

        Set-Item -Path "Env:$Key" -Value $Value
    }
}

$SUPABASE_URL = $env:SUPABASE_URL
$FUNCTION_NAME = "get-deal"
$ANON_KEY = $env:SUPABASE_ANON_KEY
$DEAL_ID = $env:DEAL_ID

if ([string]::IsNullOrWhiteSpace($SUPABASE_URL)) {
    throw "SUPABASE_URL is not set."
}

if ([string]::IsNullOrWhiteSpace($ANON_KEY)) {
    throw "SUPABASE_ANON_KEY is not set."
}

if ([string]::IsNullOrWhiteSpace($DEAL_ID)) {
    throw "DEAL_ID is not set."
}

$Endpoint = "$($SUPABASE_URL.TrimEnd('/'))/functions/v1/$FUNCTION_NAME"
$Headers = @{
    Authorization = "Bearer $ANON_KEY"
    apikey = $ANON_KEY
}
$Body = @{
    deal_id = $DEAL_ID
} | ConvertTo-Json -Depth 5

$Response = Invoke-RestMethod -Uri $Endpoint -Method POST -Headers $Headers -ContentType "application/json" -Body $Body

Write-Host "Endpoint: $Endpoint"
Write-Host "Deal ID: $DEAL_ID"
Write-Host ""
Write-Host "Parsed response:"
$Response | ConvertTo-Json -Depth 100
