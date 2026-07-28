$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
if (-not $root) {
  $root = (Get-Location).Path
}

$SERVER_IP = "test.darmavoz.ru"
$frontendDir = Join-Path $root "frontend"
$androidDir = Join-Path $frontendDir "android"
$apkPath = Join-Path $frontendDir "android/app/build/outputs/apk/debug/app-debug.apk"
$webDistPath = Join-Path $frontendDir "dist"
$frontendArchivePath = Join-Path $root "frontend-dist.tar"
$sourceDir = "/opt/darmavoz_test"
$deployDir = "/opt/darmavoz_test_deploy"
$frontendTargetDir = "/opt/daoos-kit/sites/darmavoz_test/frontend"

$remoteScript = @"
set -e
mkdir -p $frontendTargetDir
rm -rf $frontendTargetDir/*
tar -xf /tmp/frontend-dist.tar -C $frontendTargetDir
rm -f /tmp/frontend-dist.tar
cd $sourceDir
git pull origin develop
DEPLOY_REF=`$(git rev-parse HEAD)
git -C $deployDir checkout --detach `$DEPLOY_REF
docker compose -f $deployDir/docker-compose.test.yml build backend_test
docker compose -f $deployDir/docker-compose.test.yml up -d --no-deps --force-recreate backend_test
"@

Write-Host "Start local build and deploy (Darmavoz Test 2.6.0)..." -ForegroundColor Cyan

Push-Location $frontendDir
try {
  Write-Host "1/4 Build web bundle..." -ForegroundColor Yellow
  npm run build

  Write-Host "2/4 Build Android APK..." -ForegroundColor Yellow
  npx cap sync android

  Push-Location $androidDir
  try {
    .\gradlew assembleDebug
  }
  finally {
    Pop-Location
  }
}
finally {
  Pop-Location
}

Write-Host "3/4 Upload APK and frontend bundle..." -ForegroundColor Yellow
scp $apkPath "root@${SERVER_IP}:/opt/darmavoz_test_deploy/static/darmavoz-test.apk"

if (Test-Path $frontendArchivePath) {
  Remove-Item -LiteralPath $frontendArchivePath -Force
}

tar -C $webDistPath -cf $frontendArchivePath .
scp $frontendArchivePath "root@${SERVER_IP}:/tmp/frontend-dist.tar"
Remove-Item -LiteralPath $frontendArchivePath -Force

Write-Host "4/4 Update backend on server..." -ForegroundColor Yellow
$remoteScript | ssh "root@${SERVER_IP}" "bash -s"

Write-Host "Deploy completed successfully!" -ForegroundColor Green
