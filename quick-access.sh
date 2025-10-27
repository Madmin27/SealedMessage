#!/bin/bash

# ChronoMessage Quick Access Script
# Usage: ./quick-access.sh

echo "=========================================="
echo "🎯 ChronoMessage - Quick Access"
echo "=========================================="
echo ""

# Check service status
echo "📊 Service Status:"
sudo systemctl is-active --quiet sealedmessage-frontend && echo "   ✅ Service: RUNNING" || echo "   ❌ Service: STOPPED"

# Check port
if netstat -tuln | grep -q ":3000"; then
    echo "   ✅ Port 3000: LISTENING"
else
    echo "   ❌ Port 3000: NOT LISTENING"
fi

echo ""
echo "🌐 Access URLs:"
echo "   Public:  http://minen.com.tr:3000"
echo "   Local:   http://192.168.1.192:3000"
echo "   Loopback: http://localhost:3000"
echo ""

echo "📦 Contract Info:"
echo "   Address:  0xB274067B551FaA7c79a146B5215136454aE912bB"
echo "   Network:  Sepolia"
echo "   Explorer: https://sepolia.etherscan.io/address/0xB274067B551FaA7c79a146B5215136454aE912bB"
echo ""

echo "🔧 Quick Commands:"
echo "   Restart:  sudo systemctl restart sealedmessage-frontend"
echo "   Status:   sudo systemctl status sealedmessage-frontend"
echo "   Logs:     sudo journalctl -u sealedmessage-frontend -f"
echo "   Rebuild:  cd /root/zamamessage/frontend && npm run build"
echo ""

echo "🐛 Troubleshooting:"
echo "   1. Hard refresh browser: Ctrl+Shift+R (or Cmd+Shift+R)"
echo "   2. Clear browser cache completely"
echo "   3. Try incognito/private mode"
echo "   4. Check browser console for errors (F12)"
echo ""

echo "=========================================="
