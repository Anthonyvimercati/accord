# Build local du bundle Windows d'Accord (installateur NSIS .exe + MSI WiX).
#
# À lancer SUR Windows, dans PowerShell. Ne peut PAS etre produit depuis macOS :
# la chaine WiX/NSIS et la WebView2 sont propres a Windows.
#
# Prerequis (a installer AVANT de lancer ce script) :
#   - Node 20+ et npm            -> https://nodejs.org
#   - Rust stable (rustup), toolchain MSVC (x86_64-pc-windows-msvc, par defaut)
#                                  -> https://rustup.rs
#   - Build Tools C++ de Visual Studio (« Desktop development with C++ »)
#   - WebView2 Runtime : preinstalle sur Windows 11 et Windows Server 2022 ;
#     sinon l'installer depuis le site Microsoft.
#   - La CLI Tauri est fournie par les devDependencies du frontend (npm ci).
#
# Lancement :
#   powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1

# Arrete le script a la premiere erreur.
$ErrorActionPreference = 'Stop'

# Racine du depot (le script vit dans scripts\).
$Racine = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Host '== Installation des dependances frontend (si necessaire) =='
Set-Location (Join-Path $Racine 'app')
if (-not (Test-Path 'node_modules')) {
    npm ci
}

Write-Host '== Build Tauri =='
npx tauri build

# Emplacement des artefacts : target\release\bundle\{nsis,msi}
$Bundle = Join-Path $Racine 'target\release\bundle'

Write-Host ''
Write-Host '== Artefacts produits =='
if (Test-Path $Bundle) {
    Get-ChildItem -Path $Bundle -Recurse -Include '*.exe', '*.msi' |
        Select-Object FullName, @{ Name = 'Taille(Mo)'; Expression = { [math]::Round($_.Length / 1MB, 1) } } |
        Format-Table -AutoSize
    Write-Host "Dossier des bundles : $Bundle"
}
else {
    Write-Error "Aucun bundle trouve sous $Bundle — verifier la sortie du build ci-dessus."
    exit 1
}
