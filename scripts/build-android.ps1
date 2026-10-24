param(
    [string] $JavaHome,
    [string] $SdkRoot,
    [string[]] $Tasks = @(':app:testDebugUnitTest', ':app:assembleDebug', ':app:lintDebug')
)

$ErrorActionPreference = 'Stop'
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskLocalTools = Join-Path $taskRepo '.local-tools'
$taskMobileRuntime = Get-Content -LiteralPath (Join-Path $taskRepo 'mobile-runtime.json') -Raw | ConvertFrom-Json
if (-not $JavaHome) {
    $JavaHome = (Get-ChildItem -LiteralPath (Join-Path $taskLocalTools 'java27') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } |
        Select-Object -First 1).FullName
}
if (-not $SdkRoot) { $SdkRoot = Join-Path $taskLocalTools 'android-sdk' }
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))) {
    throw "Supply -JavaHome pointing to stable JDK $($taskMobileRuntime.java.version)."
}
if (-not (Test-Path -LiteralPath (Join-Path $SdkRoot ('platforms/' + $taskMobileRuntime.android.platform + '/android.jar')))) {
    throw "Supply -SdkRoot with $($taskMobileRuntime.android.platform) installed. This script does not install SDKs or accept licences."
}

$taskPreviousEnvironment = @{}
foreach ($taskVariable in @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_USER_HOME', 'GRADLE_USER_HOME')) {
    $taskPreviousEnvironment[$taskVariable] = [Environment]::GetEnvironmentVariable($taskVariable, 'Process')
}
try {
    $env:JAVA_HOME = [IO.Path]::GetFullPath($JavaHome)
    $env:ANDROID_HOME = [IO.Path]::GetFullPath($SdkRoot)
    $env:ANDROID_USER_HOME = Join-Path $taskLocalTools 'android-user'
    $env:GRADLE_USER_HOME = Join-Path $taskLocalTools 'gradle'
    & node (Join-Path $taskRepo 'scripts/check-mobile-runtime.mjs') android
    if ($LASTEXITCODE -ne 0) { throw 'Mobile SDK preflight failed.' }
    Push-Location (Join-Path $taskRepo 'android')
    try {
        & .\gradlew.bat --no-daemon --console=plain @Tasks
        if ($LASTEXITCODE -ne 0) { throw "Android build failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
} finally {
    foreach ($taskVariable in $taskPreviousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($taskVariable, $taskPreviousEnvironment[$taskVariable], 'Process')
    }
}
