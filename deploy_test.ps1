$ErrorActionPreference = "Stop"

Write-Host " Настройка окружения Windows..." -ForegroundColor Cyan
if (Test-Path "C:\Program Files\Android\Android Studio\jbr") {
  $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
  Write-Host "✅ JAVA_HOME установлен: $env:JAVA_HOME" -ForegroundColor Green
} elseif (Test-Path "C:\Program Files\Android\Android Studio\jre") {
  $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jre"
  Write-Host "✅ JAVA_HOME установлен: $env:JAVA_HOME" -ForegroundColor Green
}

# Помощь Capacitor'у в поиске Node.js на Windows
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Path
if ($nodePath) {
  $nodeDir = Split-Path $nodePath
  if ($env:PATH -notlike "*$nodeDir*") {
    $env:PATH = "$nodeDir;$env:PATH"
  }
}

function Assert-LastExitCode {
  param(
    [string]$CommandName
  )

  if ($LASTEXITCODE -ne 0) {
    throw "$CommandName failed with exit code $LASTEXITCODE"
  }
}

$root = $PSScriptRoot
if (-not $root) {
  $root = (Get-Location).Path
}

$SERVER_IP = "159.194.236.11"
$frontendDir = Join-Path $root "frontend"
$androidDir = Join-Path $frontendDir "android"
$webDistPath = Join-Path $frontendDir "dist"
$frontendArchivePath = Join-Path $root "frontend-dist.tar"
$sourceDir = "/opt/darmavoz_test"
$deployDir = "/opt/darmavoz_test_deploy"
$frontendTargetDir = "/opt/daoos-kit/sites/darmavoz_test/frontend"

$remoteCommand = @"
set -e;
mkdir -p $frontendTargetDir;
rm -rf $frontendTargetDir/*;
tar -xf /tmp/frontend-dist.tar -C $frontendTargetDir;
rm -f /tmp/frontend-dist.tar;
cd $sourceDir;
git fetch origin;
git reset --hard origin/develop;
DEPLOY_REF=`$(git rev-parse HEAD);
git -C $deployDir checkout --detach `$DEPLOY_REF;
docker compose -f $deployDir/docker-compose.test.yml build backend_test;
docker compose -f $deployDir/docker-compose.test.yml up -d --no-deps --force-recreate backend_test
"@

Write-Host "Start local build and deploy (Darmavoz Test 2.6.0)..." -ForegroundColor Cyan

Push-Location $frontendDir
try {
  Write-Host "1/4 Build web bundle..." -ForegroundColor Yellow
  npm run build
  Assert-LastExitCode "npm run build"

  Write-Host "2/4 Build Android APK..." -ForegroundColor Yellow
  npx.cmd cap sync android
  Assert-LastExitCode "npx.cmd cap sync android"

  Push-Location $androidDir
  try {
    .\gradlew.bat assembleDebug
    Assert-LastExitCode ".\\gradlew.bat assembleDebug"
  }
  finally {
    Pop-Location
  }
}
finally {
  Pop-Location
}

Write-Host "3/4 Upload APK and frontend bundle..." -ForegroundColor Yellow
scp frontend\android\app\build\outputs\apk\debug\app-debug.apk root@${SERVER_IP}:/opt/darmavoz_test_deploy/static/darmavoz-test.apk
Assert-LastExitCode "scp apk upload"

if (Test-Path $frontendArchivePath) {
  Remove-Item -LiteralPath $frontendArchivePath -Force
}

tar -C $webDistPath -cf $frontendArchivePath .
Assert-LastExitCode "tar frontend dist"
scp $frontendArchivePath "root@${SERVER_IP}:/tmp/frontend-dist.tar"
Assert-LastExitCode "scp frontend archive upload"
Remove-Item -LiteralPath $frontendArchivePath -Force

Write-Host "4/4 Update backend on server..." -ForegroundColor Yellow
ssh "root@${SERVER_IP}" $remoteCommand
Assert-LastExitCode "ssh remote deploy"

Write-Host "Deploy completed successfully!" -ForegroundColor Green
