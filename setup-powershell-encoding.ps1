# Script para configurar codificação UTF-8 no PowerShell
# Execute este script no PowerShell: .\setup-powershell-encoding.ps1

Write-Host "Configurando codificação UTF-8..." -ForegroundColor Green

# Configurar codificação UTF-8 para a sessão atual
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

Write-Host "Codificação UTF-8 configurada para esta sessão." -ForegroundColor Green
Write-Host ""

# Testar acesso à pasta frontend
$projectRoot = Get-Location
$frontendPath = Join-Path $projectRoot "frontend"

Write-Host "Testando acesso à pasta frontend..." -ForegroundColor Yellow
if (Test-Path $frontendPath) {
    Write-Host "✓ Pasta frontend encontrada!" -ForegroundColor Green
    Write-Host "  Caminho: $frontendPath" -ForegroundColor Cyan
    
    # Listar alguns arquivos
    Write-Host ""
    Write-Host "Arquivos principais:" -ForegroundColor Yellow
    Get-ChildItem $frontendPath -File | Select-Object -First 5 Name | ForEach-Object {
        Write-Host "  - $($_.Name)" -ForegroundColor Gray
    }
} else {
    Write-Host "✗ Pasta frontend não encontrada em: $frontendPath" -ForegroundColor Red
}

Write-Host ""
Write-Host "Para tornar esta configuração permanente, adicione ao seu perfil PowerShell:" -ForegroundColor Yellow
Write-Host "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8" -ForegroundColor Cyan
Write-Host "  [Console]::InputEncoding = [System.Text.Encoding]::UTF8" -ForegroundColor Cyan
Write-Host "  chcp 65001 | Out-Null" -ForegroundColor Cyan
Write-Host ""
Write-Host "Perfil localizado em: $PROFILE" -ForegroundColor Gray

