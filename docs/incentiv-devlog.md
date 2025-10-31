# Incentiv Integration Dev Log

> Tarih: 2025-10-30
> Dal: `feature/incentiv`

## Başlangıç

- Incentiv entegrasyonu için `feature/incentiv` dalı açıldı.
- Mevcut yol haritası `yolHaritasi.md` dosyasında güncellendi; temel adımlar başlıklar halinde düzenlendi.
- Hedef: Hardhat ve frontend yapılandırmalarına Incentiv test ağını eklemek, ardından güvenlik backlog'une geçmek.

## Ağ Konfigürasyonu (30 Ekim)

- Hardhat yapılandırmasına `incentiv` ağı eklendi; 30 Ekim itibarıyla `https://rpc3.testnet.incentiv.io` (chainId 28802) kullanılıyor. Env değişkeni öncelikle `INCENTIV_TESTNET_RPC_URL`, yoksa `INCENTIV_RPC_URL` olarak okunuyor.
- Frontend zincir listesi Incentiv Testnet'i tanıyor; varsayılan RPC olarak `https://rpc3.testnet.incentiv.io` kullanılıyor.
- `frontend/.env.local` örneklerine Incentiv RPC'si için yönlendirme ve sözleşme adresi boşluğu eklendi (deploy sonrası güncellenecek).

## İlk Deploy (30 Ekim)

- SealedMessage sözleşmesi Incentiv testnet (chainId 28802) üzerinde `0xa1495F1a4c93e1acD5d178270404C8e8b225C4B5` adresine dağıtıldı.
- Deployment çıktısı `deployments/incentiv.json` dosyasına kaydedildi.
- Frontend tarafında `NEXT_PUBLIC_CONTRACT_ADDRESS_INCENTIV` env değeri bu adresle güncellendi.

## Smoke Test (30 Ekim)

- `scripts/smoke-incentiv.ts` ile Incentiv testnet üzerinde bir örnek mesaj oluşturularak kontrat fonksiyonları doğrulandı (tx block 1176149).
- Smoke test sırasında `messageCount` 0'dan 1'e yükseldi; veriler `0x1111...1111` alıcı adresi için kaydedildi.

## Bug Fixes (30 Ekim)

- Gönderici ve alıcı tarafındaki fallback anahtar üretimi senkronize edildi (`MessageCard` artık `lib/fallbackKey` kullanıyor). Alıcı cüzdanının on-chain anahtar kaydı olmadığında fallback ile şifrelenen mesajlar düzgün çözülebiliyor.
- `decryptMessage` fonksiyonu fallback özel anahtarını da adaylar arasında deneyerek envelope çözümünde `DOMException` hatalarının önüne geçiyor.

## Açık Sorular

- Incentiv ağı için resmi block explorer URL'si yayınlandı mı? Dokümantasyonda belirtilmemiş, gerekirse testnet ekibiyle doğrulanacak.
- Sequence Portal / Incentiv SDK’nın zorunlu tuttuğu özel signer akışı mevcut wagmi yapısına nasıl eklenecek? Araştırma tamamlanacak.

---

> Not: Her önemli ilerleme adımından sonra bu log güncellenecek.
