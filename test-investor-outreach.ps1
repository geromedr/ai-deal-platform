$EnvFilePath = Join-Path $PSScriptRoot ".env"

function Import-DotEnv {
    param (
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return
    }

    Get-Content $Path | ForEach-Object {
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

Import-DotEnv -Path $EnvFilePath

$SUPABASE_URL = $env:SUPABASE_URL
$SUPABASE_ANON_KEY = $env:SUPABASE_ANON_KEY
$FUNCTION_NAME = "investor-outreach"

if ([string]::IsNullOrWhiteSpace($SUPABASE_URL)) {
    throw "SUPABASE_URL is not set."
}

if ([string]::IsNullOrWhiteSpace($SUPABASE_ANON_KEY)) {
    throw "SUPABASE_ANON_KEY is not set."
}

$Endpoint = "$($SUPABASE_URL.TrimEnd('/'))/functions/v1/$FUNCTION_NAME"
$Headers = @{
    Authorization = "Bearer $SUPABASE_ANON_KEY"
    apikey = $SUPABASE_ANON_KEY
}

$Body = @{
    deal_id = "11111111-1111-1111-1111-111111111111"
    investor_id = "33333333-3333-3333-3333-333333333333"
} | ConvertTo-Json -Depth 5

$Response = Invoke-RestMethod -Uri $Endpoint -Method POST -Headers $Headers -ContentType "application/json" -Body $Body

$Subject = if ($null -ne $Response.subject) { [string]$Response.subject } else { "" }
$Message = if ($null -ne $Response.message) { [string]$Response.message } else { "" }

Write-Host "Endpoint: $Endpoint"
Write-Host ""
Write-Host "Subject:"
Write-Host $Subject
Write-Host ""
Write-Host "Message:"
Write-Host $Message
