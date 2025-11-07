# Aliases e funções úteis para o projeto Hookify
# Adicione este conteúdo ao seu perfil PowerShell ($PROFILE) ou execute: . .\hookify-aliases.ps1

# Caminho base do projeto (ajuste conforme necessário)
# Tenta detectar automaticamente ou usa o caminho padrão
$HookifyProjectPath = if (Test-Path "C:\Users\worki\OneDrive\Área de Trabalho\Projects\Hookify") {
    "C:\Users\worki\OneDrive\Área de Trabalho\Projects\Hookify"
} elseif ($PSScriptRoot) {
    # Se executado a partir de um script, usa o diretório do script
    Split-Path -Parent $PSScriptRoot
} else {
    # Tenta usar o diretório atual se estiver no projeto
    $currentPath = Get-Location
    if (Test-Path (Join-Path $currentPath "frontend")) {
        $currentPath.Path
    } else {
        "C:\Users\worki\OneDrive\Área de Trabalho\Projects\Hookify"
    }
}

# Função para ir ao diretório raiz do projeto
function Go-Hookify {
    param(
        [string]$SubPath = ""
    )
    
    $targetPath = if ($SubPath) {
        Join-Path $HookifyProjectPath $SubPath
    } else {
        $HookifyProjectPath
    }
    
    if (Test-Path $targetPath) {
        Set-Location $targetPath
        Write-Host "Navegado para: $targetPath" -ForegroundColor Green
    } else {
        Write-Host "Caminho não encontrado: $targetPath" -ForegroundColor Red
    }
}

# Funções específicas para subdiretórios
function Go-Frontend {
    Go-Hookify "frontend"
}

function Go-Backend {
    Go-Hookify "backend"
}

function Go-Deploy {
    Go-Hookify "deploy"
}

# Criar aliases
Set-Alias -Name hookify -Value Go-Hookify -Scope Global -ErrorAction SilentlyContinue
Set-Alias -Name frontend -Value Go-Frontend -Scope Global -ErrorAction SilentlyContinue
Set-Alias -Name backend -Value Go-Backend -Scope Global -ErrorAction SilentlyContinue
Set-Alias -Name deploy -Value Go-Deploy -Scope Global -ErrorAction SilentlyContinue

Write-Host "Aliases do Hookify carregados!" -ForegroundColor Green
Write-Host "  hookify  - Vai para a raiz do projeto" -ForegroundColor Cyan
Write-Host "  frontend - Vai para frontend/" -ForegroundColor Cyan
Write-Host "  backend  - Vai para backend/" -ForegroundColor Cyan
Write-Host "  deploy   - Vai para deploy/" -ForegroundColor Cyan

