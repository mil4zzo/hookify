# Script rápido para acessar pastas do projeto Hookify
# Usa caminho curto (8.3) para evitar problemas com caracteres especiais
# Execute: . .\quick-access.ps1

# Configurar UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

# Caminho usando nome curto (8.3) para evitar problemas com "Área de Trabalho"
# READET~1 é o nome curto de "Área de Trabalho"
$HookifyRoot = "C:\Users\worki\OneDrive\READET~1\Projects\Hookify"

# Função para navegar
function Go-Hookify {
    param([string]$SubPath = "")
    
    $targetPath = if ($SubPath) {
        Join-Path $HookifyRoot $SubPath
    } else {
        $HookifyRoot
    }
    
    if (Test-Path $targetPath) {
        Set-Location $targetPath
        Write-Host "✓ Navegado para: $targetPath" -ForegroundColor Green
        Get-Location
    } else {
        Write-Host "✗ Caminho não encontrado: $targetPath" -ForegroundColor Red
    }
}

# Funções específicas
function Go-Frontend { Go-Hookify "frontend" }
function Go-Backend { Go-Hookify "backend" }
function Go-Deploy { Go-Hookify "deploy" }

# Criar aliases
Set-Alias -Name hookify -Value Go-Hookify -Scope Global -ErrorAction SilentlyContinue
Set-Alias -Name frontend -Value Go-Frontend -Scope Global -ErrorAction SilentlyContinue
Set-Alias -Name backend -Value Go-Backend -Scope Global -ErrorAction SilentlyContinue
Set-Alias -Name deploy -Value Go-Deploy -Scope Global -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== Aliases do Hookify Carregados ===" -ForegroundColor Cyan
Write-Host "  hookify  - Vai para a raiz do projeto" -ForegroundColor Yellow
Write-Host "  frontend - Vai para frontend/" -ForegroundColor Yellow
Write-Host "  backend  - Vai para backend/" -ForegroundColor Yellow
Write-Host "  deploy   - Vai para deploy/" -ForegroundColor Yellow
Write-Host ""

# Testar acesso
Write-Host "Testando acesso..." -ForegroundColor Cyan
$frontendPath = Join-Path $HookifyRoot "frontend"
if (Test-Path $frontendPath) {
    Write-Host "✓ Pasta frontend acessível!" -ForegroundColor Green
} else {
    Write-Host "✗ Pasta frontend não encontrada" -ForegroundColor Red
}

