param(
    [Parameter(Mandatory = $true)][string]$JavaHome,
    [Parameter(Mandatory = $true)][string]$JUnitJar,
    [Parameter(Mandatory = $true)][string]$HamcrestJar,
    [Parameter(Mandatory = $true)][string]$JsonJar
)
$ErrorActionPreference = 'Stop'
$taskRepo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskOutput = Join-Path $taskRepo '.local-tools\java-tests\classes'
$taskJavac = Join-Path $JavaHome 'bin\javac.exe'
$taskJava = Join-Path $JavaHome 'bin\java.exe'
foreach ($taskFile in @($taskJavac, $taskJava, $JUnitJar, $HamcrestJar, $JsonJar)) {
    if (-not (Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw "Required compiler or test dependency is missing: $taskFile" }
}
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskClasspath = @((Resolve-Path -LiteralPath $JUnitJar).Path, (Resolve-Path -LiteralPath $HamcrestJar).Path, (Resolve-Path -LiteralPath $JsonJar).Path) -join ';'
$taskMain = Join-Path $taskRepo 'android\app\src\main\java\com\packingscanning\app\scanning'
$taskTests = Join-Path $taskRepo 'android\app\src\test\java\com\packingscanning\app\scanning'
$taskSources = @('DepthCloud.java', 'DepthProjection.java', 'ScanEnvelope.java', 'VoxelSolid.java', 'VoxelCavity.java', 'CaptureStore.java') | ForEach-Object { Join-Path $taskMain $_ }
$taskSources += @('DepthCloudTest.java', 'ScanEnvelopeTest.java', 'VoxelSolidTest.java', 'VoxelCavityTest.java', 'CaptureStoreTest.java', 'CaptureInteriorTest.java') | ForEach-Object { Join-Path $taskTests $_ }
& $taskJavac --release 21 -cp $taskClasspath -d $taskOutput @taskSources
if ($LASTEXITCODE -ne 0) { throw 'Android geometry test compilation failed.' }
& $taskJava -cp "$taskOutput;$taskClasspath" org.junit.runner.JUnitCore com.packingscanning.app.scanning.DepthCloudTest com.packingscanning.app.scanning.ScanEnvelopeTest com.packingscanning.app.scanning.VoxelSolidTest com.packingscanning.app.scanning.VoxelCavityTest com.packingscanning.app.scanning.CaptureStoreTest com.packingscanning.app.scanning.CaptureInteriorTest
if ($LASTEXITCODE -ne 0) { throw 'Android geometry or private capture storage tests failed.' }
