import os, json

BASE = r'C:\Users\USER\Tokenized-Fractional-'
FRONTEND = os.path.join(BASE, 'frontend')

# ====== 1. Fix ProfilePage.jsx ======
jsx_path = os.path.join(FRONTEND, 'src', 'components', 'ProfilePage', 'ProfilePage.jsx')
with open(jsx_path, 'r', encoding='utf-8') as f:
    jsx = f.read()

# Remove unused imports
jsx = jsx.replace("import React, { useState, useEffect, useCallback } from 'react';", "import React, { useState, useEffect, useCallback } from 'react';")
jsx = jsx.replace("import Spinner from '../Spinner/Spinner';\n", "")

# Add i18n import
jsx = jsx.replace(
    "import { useToastStore } from '../../store/useToastStore';",
    "import { useTranslation } from 'react-i18next';\nimport { useToastStore } from '../../store/useToastStore';"
)

# Add useTranslation hook after function start
jsx = jsx.replace(
    "export default function ProfilePage() {",
    "export default function ProfilePage() {\n  const { t } = useTranslation();"
)

# Helper to add translation calls - replace hardcoded strings
replacements = {
    "'Address copied to clipboard!'": "t('profile.copied')",
    "'Failed to copy address'": "t('profile.copyFailed')",
    "'Your Profile Dashboard'": "t('profile.title')",
    "'Connect your Freighter wallet to view portfolio, manage preferences, download NFT certificates, and track your transaction history.'": "t('profile.connectDesc')",
    "'Connecting...'": "t('wallet.connecting')",
    "'Connect Freighter'": "t('wallet.connect')",
    "'My Dashboard'": "t('profile.dashboard')",
    "'Copy wallet address'": "t('profile.copyAddress')",
    "'Copy wallet address'": "t('profile.copyAddress')",
    "'Preferences'": "t('profile.preferences')",
    "'Disconnect'": "t('wallet.disconnect')",
    "'Overview'": "t('profile.overview')",
    "'Certificates'": "t('profile.certificates')",
    "'Activity'": "t('profile.activity')",
    "'Support'": "t('profile.support')",
    "'Portfolio Value'": "t('profile.portfolioValue')",
    "'+2.4% this week'": "t('profile.thisWeek')",
    "'Assets Held'": "t('profile.assetsHeld')",
    "'Total Shares'": "t('profile.totalShares')",
    "'Asset Allocation'": "t('profile.assetAllocation')",
    "'No assets to display'": "t('profile.noAssets')",
    "'No assets allocated yet'": "t('profile.noAllocation')",
    "'Recent Transactions'": "t('profile.recentTx')",
    "'All'": "t('profile.all')",
    "'Success'": "t('profile.success')",
    "'Failed'": "t('profile.failed')",
    "'No transactions found'": "t('profile.noTx')",
    "'Certificate Gallery'": "t('profile.certGallery')",
    "'Grid view'": "t('profile.gridView')",
    "'List view'": "t('profile.listView')",
    "'Ownership Certificate'": "t('profile.ownershipCert')",
    "'Asset Certificate'": "t('profile.assetCert')",
    "'Certificate'": "t('profile.certificate')",
    "'No certificates available yet'": "t('profile.noCerts')",
    "'Purchase shares to generate NFT certificates.'": "t('profile.noCertsSub')",
    "'Activity Timeline'": "t('profile.activityTimeline')",
    "'Wallet connected'": "t('profile.walletConnected')",
    "'Shares purchased'": "t('profile.sharesPurchased')",
    "'5 shares of Asset #1'": "t('profile.sharesPurchasedDetail')",
    "'Portfolio viewed'": "t('profile.portfolioViewed')",
    "'Certificate downloaded'": "t('profile.certDownloaded')",
    "'Transaction completed'": "t('profile.txCompleted')",
    "'Payment received'": "t('profile.paymentReceived')",
    "'Help Center'": "t('profile.helpCenter')",
    "'Browse FAQs and guides'": "t('profile.helpCenterDesc')",
    "'Contact Support'": "t('profile.contactSupport')",
    "'Get help from our team'": "t('profile.contactSupportDesc')",
    "'GitHub Issues'": "t('profile.githubIssues')",
    "'Report bugs or request features'": "t('profile.githubIssuesDesc')",
    "'Documentation'": "t('profile.documentation')",
    "'Read the full documentation'": "t('profile.documentationDesc')",
    "'Display Currency'": "t('profile.displayCurrency')",
    "'Notifications'": "t('profile.notifications')",
    "'Email notifications for transactions'": "t('profile.emailNotifs')",
    "'Push notifications for price alerts'": "t('profile.pushNotifs')",
    "'Default View'": "t('profile.defaultView')",
    "'Save'": "t('profile.save')",
    "'Cancel'": "t('profile.cancel')",
    "'Preferences saved!'": "t('profile.prefsSaved')",
    "'USD ($)'": "t('profile.usd')",
    "'EUR (€)'": "t('profile.eur')",
    "'GBP (£)'": "t('profile.gbp')",
}

for old_str, new_str in replacements.items():
    jsx = jsx.replace(old_str, new_str)

with open(jsx_path, 'w', encoding='utf-8') as f:
    f.write(jsx)
print('1. ProfilePage.jsx fixed')

# ====== 2. Fix CSS formatting - expand single-line rules ======
css_path = os.path.join(FRONTEND, 'src', 'components', 'ProfilePage', 'ProfilePage.module.css')
with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()

# Function to expand single-line CSS rules
import re

def expand_css_line(match):
    selector = match.group(1).strip()
    body = match.group(2).strip()
    if ';' in body:
        props = body.split(';')
        expanded = selector + ' {\n'
        for p in props:
            p = p.strip()
            if p:
                expanded += '  ' + p + ';\n'
        expanded += '}\n'
        return expanded
    return match.group(0)

# Find single-line rules: selector { props; props; }
css = re.sub(r'^([.#@\w\-, :>\(\)\[\]=]+)\s*\{([^}]+)\}$', expand_css_line, css, flags=re.MULTILINE)

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css)
print('2. CSS formatting fixed')

# ====== 3. Add i18n translations ======
def add_profile_to_locale(locale_path, translations):
    with open(locale_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if 'profile' not in data:
        data['profile'] = translations
        with open(locale_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f'Added profile translations to {os.path.basename(locale_path)}')
    else:
        print(f'profile already exists in {os.path.basename(locale_path)}')

# Also add 'profile' to nav section
for locale_path in [os.path.join(FRONTEND, 'src', 'locales', 'en.json'), os.path.join(FRONTEND, 'src', 'locales', 'es.json')]:
    with open(locale_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if 'profile' not in data.get('nav', {}):
        data.setdefault('nav', {})['profile'] = 'Profile' if 'en' in locale_path else 'Perfil'
        with open(locale_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f'Added nav.profile to {os.path.basename(locale_path)}')

en_translations = {
    "dashboard": "My Dashboard",
    "title": "Your Profile Dashboard",
    "connectDesc": "Connect your Freighter wallet to view portfolio, manage preferences, download NFT certificates, and track your transaction history.",
    "copied": "Address copied to clipboard!",
    "copyFailed": "Failed to copy address",
    "copyAddress": "Copy wallet address",
    "preferences": "Preferences",
    "overview": "Overview",
    "certificates": "Certificates",
    "activity": "Activity",
    "support": "Support",
    "portfolioValue": "Portfolio Value",
    "thisWeek": "+2.4% this week",
    "assetsHeld": "Assets Held",
    "totalShares": "Total Shares",
    "assetAllocation": "Asset Allocation",
    "noAssets": "No assets to display",
    "noAllocation": "No assets allocated yet",
    "recentTx": "Recent Transactions",
    "all": "All",
    "success": "Success",
    "failed": "Failed",
    "noTx": "No transactions found",
    "certGallery": "Certificate Gallery",
    "gridView": "Grid view",
    "listView": "List view",
    "ownershipCert": "Ownership Certificate",
    "assetCert": "Asset Certificate",
    "certificate": "Certificate",
    "noCerts": "No certificates available yet",
    "noCertsSub": "Purchase shares to generate NFT certificates.",
    "activityTimeline": "Activity Timeline",
    "walletConnected": "Wallet connected",
    "sharesPurchased": "Shares purchased",
    "sharesPurchasedDetail": "5 shares of Asset #1",
    "portfolioViewed": "Portfolio viewed",
    "certDownloaded": "Certificate downloaded",
    "txCompleted": "Transaction completed",
    "paymentReceived": "Payment received",
    "helpCenter": "Help Center",
    "helpCenterDesc": "Browse FAQs and guides",
    "contactSupport": "Contact Support",
    "contactSupportDesc": "Get help from our team",
    "githubIssues": "GitHub Issues",
    "githubIssuesDesc": "Report bugs or request features",
    "documentation": "Documentation",
    "documentationDesc": "Read the full documentation",
    "displayCurrency": "Display Currency",
    "notifications": "Notifications",
    "emailNotifs": "Email notifications for transactions",
    "pushNotifs": "Push notifications for price alerts",
    "defaultView": "Default View",
    "save": "Save",
    "cancel": "Cancel",
    "prefsSaved": "Preferences saved!",
    "usd": "USD ($)",
    "eur": "EUR (€)",
    "gbp": "GBP (£)"
}

es_translations = {
    "dashboard": "Mi Panel",
    "title": "Tu Panel de Perfil",
    "connectDesc": "Conecta tu billetera Freighter para ver tu cartera, gestionar preferencias, descargar certificados NFT y rastrear tu historial de transacciones.",
    "copied": "Dirección copiada al portapapeles!",
    "copyFailed": "Error al copiar la dirección",
    "copyAddress": "Copiar dirección de billetera",
    "preferences": "Preferencias",
    "overview": "Resumen",
    "certificates": "Certificados",
    "activity": "Actividad",
    "support": "Soporte",
    "portfolioValue": "Valor del Portafolio",
    "thisWeek": "+2.4% esta semana",
    "assetsHeld": "Activos",
    "totalShares": "Acciones Totales",
    "assetAllocation": "Asignación de Activos",
    "noAssets": "Sin activos para mostrar",
    "noAllocation": "Sin activos asignados aún",
    "recentTx": "Transacciones Recientes",
    "all": "Todo",
    "success": "Éxito",
    "failed": "Fallido",
    "noTx": "Sin transacciones",
    "certGallery": "Galería de Certificados",
    "gridView": "Vista cuadrícula",
    "listView": "Vista lista",
    "ownershipCert": "Certificado de Propiedad",
    "assetCert": "Certificado de Activo",
    "certificate": "Certificado",
    "noCerts": "Sin certificados aún",
    "noCertsSub": "Compra acciones para generar certificados NFT.",
    "activityTimeline": "Línea de Tiempo",
    "walletConnected": "Billetera conectada",
    "sharesPurchased": "Acciones compradas",
    "sharesPurchasedDetail": "5 acciones del Activo #1",
    "portfolioViewed": "Portafolio visto",
    "certDownloaded": "Certificado descargado",
    "txCompleted": "Transacción completada",
    "paymentReceived": "Pago recibido",
    "helpCenter": "Centro de Ayuda",
    "helpCenterDesc": "Explora preguntas frecuentes y guías",
    "contactSupport": "Contactar Soporte",
    "contactSupportDesc": "Obtén ayuda de nuestro equipo",
    "githubIssues": "Issues de GitHub",
    "githubIssuesDesc": "Reporta bugs o solicita funciones",
    "documentation": "Documentación",
    "documentationDesc": "Lee la documentación completa",
    "displayCurrency": "Moneda",
    "notifications": "Notificaciones",
    "emailNotifs": "Notificaciones por correo",
    "pushNotifs": "Notificaciones push de precios",
    "defaultView": "Vista por Defecto",
    "save": "Guardar",
    "cancel": "Cancelar",
    "prefsSaved": "Preferencias guardadas!",
    "usd": "USD ($)",
    "eur": "EUR (€)",
    "gbp": "GBP (£)"
}

add_profile_to_locale(os.path.join(FRONTEND, 'src', 'locales', 'en.json'), en_translations)
add_profile_to_locale(os.path.join(FRONTEND, 'src', 'locales', 'es.json'), es_translations)
print('3. i18n translations added to en.json and es.json')

print('\n=== ALL 3 ISSUES FIXED ===')
