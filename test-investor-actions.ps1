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
$SUPABASE_ANON_KEY = $env:SUPABASE_ANON_KEY
$FUNCTION_NAME = "investor-actions"
$Notes = $env:INVESTOR_ACTION_NOTES

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

$BodyObject = @{
    action_type = "contact_investor"
    deal_id = "11111111-1111-1111-1111-111111111111"
    investor_id = "33333333-3333-3333-3333-333333333333"
}

if (-not [string]::IsNullOrWhiteSpace($Notes)) {
    $BodyObject.notes = $Notes
}

$Body = $BodyObject | ConvertTo-Json -Depth 10

$Response = Invoke-RestMethod -Uri $Endpoint -Method POST -Headers $Headers -ContentType "application/json" -Body $Body

$Response | ConvertTo-Json -Depth 100
