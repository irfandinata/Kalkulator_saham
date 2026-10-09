# Kalkulator Avg & Right Issue

Web kalkulator saham dengan dua kategori yang dipilih lewat tab di bagian atas. Hanya satu kategori yang tampil dalam satu waktu. Tanpa framework, tanpa build: cukup HTML, CSS, dan JavaScript.

| Tab | Untuk apa |
| --- | --- |
| **Hitung Avg** | Harga rata-rata (avg) baru setelah beli lagi, termasuk beberapa kali pembelian, untung/rugi di harga pasar, dan target avg. |
| **Right Issue** | Jumlah HMETD, dana tebus, harga teoritis setelah ex-date, dan perbandingan tebus / jual / biarkan hangus. |

Tab yang aktif bisa dibuka langsung lewat alamat `#avg` atau `#right-issue`.

## Cara menjalankan

Buka `index.html` langsung di browser (klik dua kali). Kalau ingin lewat server lokal:

```bash
npx serve .
```

## Fitur

**Hitung Avg**
- Posisi sekarang (lot atau lembar) dan harga rata-rata.
- Sampai 6 baris pembelian baru, masing-masing dengan jumlah dan harga beli.
- Harga pasar opsional untuk melihat untung/rugi sebelum dan sesudah beli.
- Target avg: berapa lot yang perlu dibeli di harga tertentu supaya avg sampai ke target.

**Right Issue**
- Rasio bebas, termasuk rasio besar seperti `100.000.000 : 12.345.678`.
- Slider dan tombol cepat untuk menebus sebagian HMETD (0–100%).
- Harga teoritis, nilai 1 HMETD, dan perubahan porsi kepemilikan.
- Tombol **Bawa data ini ke Hitung Avg** untuk menghitung avg setelah tebus.

**Umum**
- Format angka otomatis gaya Indonesia (titik ribuan, koma desimal).
- Peta harga, rincian lengkap, dan salin ringkasan.
- Tema terang/gelap mengikuti sistem, responsif di ponsel.
- Data tiap tab tersimpan terpisah di `localStorage` browser.

## Rumus

**Hitung Avg**

| Hitungan | Rumus |
| --- | --- |
| Avg baru | `(lembar lama × avg lama + Σ lembar beli × harga beli) ÷ (lembar lama + Σ lembar beli)` |
| Untung/rugi | `total lembar × harga pasar − total modal` |
| Lembar untuk target | `lembar lama × (avg lama − target) ÷ (target − harga beli)`, dibulatkan ke atas per lot |

**Right Issue** (rasio `A : B`, 1 HMETD = 1 saham baru)

| Hitungan | Rumus |
| --- | --- |
| HMETD diterima | `floor(lembar lama × B ÷ A)` |
| Dana tebus | `HMETD ditebus × harga tebus` |
| Harga teoritis (TERP) | `(A × harga cum + B × harga tebus) ÷ (A + B)` |
| Nilai teoritis HMETD | `harga teoritis − harga tebus` |

## Struktur

```
index.html   struktur halaman (dua tab: #panel-avg dan #panel-ri)
style.css    tampilan (token warna, tema terang/gelap, layout)
app.js       logika hitung per mode, format angka, render hasil
```

Hasil hanya simulasi, bukan rekomendasi investasi. Belum termasuk biaya broker dan pajak.
