
AES-256-GCM şifreleme API'si eklenecek
ECDH key exchange implementasyonu yapılacak
IPFS'e şifreli veri yüklenecek

Şifreleme sisteminin daha sağlam ve çözülemez ve hızlı olması için contract değişikliği gerekiyorsa çekinme yap.
Geçici çözümler uyguladınsa unutma ve tekrar sağlamlaştır.

Keylerim dosyaların içerisinde değil, her zaman env dosyalarında olsun ve tek biryerden çekilsin

Testleri bitince bakalım
Test sürecinde eski mesajları önemseme, sorunsuz olursa, komple yeniden deploy ederiz

Zaman koşullu gibi payment koşullu messsaj da göndermemiz gerekebilr. Metadaata içerisinde alan olması gerekiyorsa yerini şimdiden yap

Tüm mesajları bir defada çekme yerine, son 5 mesajı çekip, öncekiler butonuna tıklanırsa 5 tanden öncekiler çekilsin

Her zaman türkçe yanıt ver
Projedeki yorum ve açıklamlar ve uyarılar ingilizce olsun
npx hardhat compile
 
cd /root/Dapps/SealedMessage/frontend &&
rm -rf .next node_modules/.cache &&
npm run build &&
sudo systemctl restart sealed.service


port 3005 de çalışıyor

gerekiyorsa cache temizliği, rebuilt ve restart service
Artık Wagmi hooks bypass edildi ve direkt ethers.js ile transaction gönderiliyor!


// grep -EHrn "Scan the file for malware before downloading." . --exclude-dir=var
// grep -EHrn "fff" . --include=\*.js --exclude-dir=./.next/cache
 
Gönderici ve alıcı akışlarının yeniden tasarlanması
- Gönderici tarafında üç katmanlı şifreleme: env + HSM fallback anahtar parçaları ile dış katmanı üret, escrow-dağıtımlı oturum anahtarını AES-256-GCM ile sar, alıcıya özel ECIES katmanını ekle.
- Contract değişikliğinde sadece escrow tarafından çözülebilecek oturum anahtarını sakla, zaman ve ödeme koşullarını aynı yapıda tut.
- Gönderici testleri: yeni akışta mesaj oluştur, IPFS'e şifreli blob yükle, contract kaydının eski koşulları sağlamadığını ve erken çözümlemenin engellendiğini doğrula.
- Alıcı testleri: mesaj kilidi açılmadan deşifre etmeyi dene (başarısız olmalı), kilit açıldıktan sonra çok katmanlı çözüm adımlarını sırayla uygula ve içerik erişimini doğrula.

her buildden önce cache temizliği yap
- Her iki test turundan sonra `cd /root/Dapps/SealedMessage/frontend && npm run build` ile ön yüzü yeniden doğrula, gerekirse servis restart et.

Sıradaki Görevler
güvenlik kontrollerine, gereksiz debugların silinmesine, denk gelirsen türkçe ifadelerin ingilizce yapılmasına.
Gereksiz test fonksiyon ve test dosyalarının kaldırılmasına geçebiliriz.

Sonrasında şifreleme sistemini kontrol etmek için env dosyasını kullanmadan dışarıdan bir betikle aşabilecek miyiz, yani alıcı bizim zaman ve ödeme koşullarını aşarak okuyabilecek mi? onların kontrollerini yapacağız

Sonra env dosyamıza 2 tane key koymuştuk, birin başka güvenli bir sunucuya vea şifreli alana taşıyacaktık

Keyler dosyalarda ise env dosyalarına taşı
Contract adresi gibi değişebilecek olanları da env dosyalarına taşı