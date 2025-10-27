#!/bin/bash

# ChronoMessage - UFW Firewall Kuralları

echo "🔒 ChronoMessage için UFW kuralları yapılandırılıyor..."
echo ""

# UFW durumunu kontrol et
if ! command -v ufw &> /dev/null; then
    echo "❌ UFW kurulu değil. Kurmak için:"
    echo "   sudo apt install ufw"
    exit 1
fi

echo "📋 Mevcut UFW durumu:"
sudo ufw status numbered
echo ""

# Kullanıcıya sor
read -p "🤔 ChronoMessage portlarını açmak istiyor musunuz? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🔓 Portlar açılıyor..."
    
    # SSH emniyeti için önce SSH'yi ekle (eğer yoksa)
    if ! sudo ufw status | grep -q "22/tcp"; then
        echo "   🛡️  SSH (22/tcp) ekleniyor (güvenlik için)..."
        sudo ufw allow 22/tcp comment 'SSH'
    fi
    
    # ChronoMessage portları
    echo "   🌐 Frontend (3000/tcp) ekleniyor..."
    sudo ufw allow 3000/tcp comment 'ChronoMessage Frontend'
    
    echo "   ⛓️  Hardhat RPC (8547/tcp) ekleniyor..."
    sudo ufw allow 8547/tcp comment 'Hardhat RPC Node'
    
    echo ""
    echo "✅ Kurallar eklendi!"
    echo ""
    
    # UFW'yi aktif et (eğer değilse)
    if ! sudo ufw status | grep -q "Status: active"; then
        echo "🔥 UFW aktif değil. Aktif etmek istiyor musunuz?"
        echo "   ⚠️  UYARI: SSH (22) portunu açtığınızdan emin olun!"
        read -p "   UFW'yi aktif et? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo ufw --force enable
            echo "   ✅ UFW aktif edildi"
        fi
    fi
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📊 Güncel UFW Kuralları:"
    sudo ufw status numbered
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "🌐 Erişim Bilgileri:"
    SERVER_IP=$(hostname -I | awk '{print $1}')
    echo "   Sunucu IP: $SERVER_IP"
    echo "   Frontend:  http://$SERVER_IP:3000"
    echo "   RPC Node:  http://$SERVER_IP:8547"
    echo ""
    echo "🔒 Güvenlik Notu:"
    echo "   • Bu portlar herkese açık olacak!"
    echo "   • Sadece güvendiğiniz ağlarda kullanın"
    echo "   • Üretim için VPN veya IP beyaz listesi kullanın"
    echo ""
    echo "🛑 Kuralları kaldırmak için:"
    echo "   sudo ufw delete allow 3000/tcp"
    echo "   sudo ufw delete allow 8547/tcp"
    echo ""
else
    echo ""
    echo "❌ İptal edildi. Port yapılandırması yapılmadı."
    echo ""
    echo "💡 Sadece localhost'ta çalışmak istiyorsanız:"
    echo "   npm run hardhat:test      # Testler"
    echo "   cd frontend && npm run dev # Frontend (localhost:3000)"
    echo ""
fi
