#!/bin/bash

# ChronoMessage - Uzaktan Erişim için Başlatma Scripti

echo "🚀 ChronoMessage Uzaktan Erişim Modunda Başlatılıyor..."
echo ""

# Sunucu IP'sini al
SERVER_IP=$(hostname -I | awk '{print $1}')
echo "📍 Sunucu IP: $SERVER_IP"
echo ""

# 1. Hardhat node'u tüm arayüzlerde dinle
echo "1️⃣ Hardhat node başlatılıyor (port 8547)..."
cd /root/zamamessage
npx hardhat node --hostname 0.0.0.0 --port 8547 > /tmp/hardhat.log 2>&1 &
HARDHAT_PID=$!
echo "   ✅ Hardhat PID: $HARDHAT_PID"
sleep 5

# 2. Kontratı deploy et
echo ""
echo "2️⃣ Kontrat deploy ediliyor..."
npx hardhat run scripts/deploy.ts --network localhost
CONTRACT_ADDRESS=$(cat deployments/localhost.json | grep -o '"address": "[^"]*"' | cut -d'"' -f4)
echo "   ✅ Kontrat adresi: $CONTRACT_ADDRESS"

# 3. Frontend .env.local güncelle
echo ""
echo "3️⃣ Frontend yapılandırması güncelleniyor..."
cd /root/zamamessage/frontend
cat > .env.local << EOF
NEXT_PUBLIC_CONTRACT_ADDRESS=$CONTRACT_ADDRESS
NEXT_PUBLIC_RPC_URL=http://$SERVER_IP:8547
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_CHAIN_NAME=Hardhat Local
NEXT_PUBLIC_CHAIN_KEY=hardhat
NEXT_PUBLIC_CHAIN_CURRENCY_NAME=Ether
NEXT_PUBLIC_CHAIN_CURRENCY_SYMBOL=ETH
NEXT_PUBLIC_CHAIN_DECIMALS=18
NEXT_PUBLIC_EXPLORER_URL=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
EOF
echo "   ✅ .env.local güncellendi"

# 4. Next.js'i tüm arayüzlerde başlat
echo ""
echo "4️⃣ Frontend başlatılıyor (port 3000)..."
npm run dev -- -H 0.0.0.0 > /tmp/nextjs.log 2>&1 &
NEXT_PID=$!
echo "   ✅ Next.js PID: $NEXT_PID"

sleep 3
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ ChronoMessage başarıyla başlatıldı!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Erişim Bilgileri:"
echo "   Frontend:  http://$SERVER_IP:3000"
echo "   RPC Node:  http://$SERVER_IP:8547"
echo "   Kontrat:   $CONTRACT_ADDRESS"
echo ""
echo "📱 MetaMask Ayarları:"
echo "   Ağ Adı:    Hardhat Local"
echo "   RPC URL:   http://$SERVER_IP:8547"
echo "   Chain ID:  31337"
echo "   Sembol:    ETH"
echo ""
echo "🔥 Firewall Kuralları (Gerekirse):"
echo "   sudo ufw allow 3000/tcp comment 'ChronoMessage Frontend'"
echo "   sudo ufw allow 8547/tcp comment 'Hardhat RPC'"
echo ""
echo "🛑 Durdurmak için:"
echo "   kill $HARDHAT_PID $NEXT_PID"
echo "   # veya: pkill -f 'hardhat node' && pkill -f 'next dev'"
echo ""
echo "📊 Loglar:"
echo "   Hardhat:   tail -f /tmp/hardhat.log"
echo "   Next.js:   tail -f /tmp/nextjs.log"
echo ""
