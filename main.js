import { ethers } from "ethers";
import { CONTRACT_ADDRESS, SEPOLIA_CHAIN_ID } from "./config.js";

const ABI = [
  "function bendaharaUmum() view returns (address)",
  "function jumlahProposal() view returns (uint256)",
  "function saldoKas() view returns (uint256)",
  "function daftarProposal(uint256) view returns (string namaKegiatan, string divisi, uint256 nominalDana, address pemohon, uint8 status)",
  "function setorKas() payable",
  "function ajukanProposal(string namaKegiatan, string divisi, uint256 danaMilliEther)",
  "function setujuiDanCairkan(uint256 idProposal)",
  "function tolakProposal(uint256 idProposal)"
];

let provider = null;
let signer = null;
let contract = null;
let currentAccount = "";

function getEl(id) {
  return document.getElementById(id);
}

function setStatus(pesan, tipe = "info") {
  const statusEl = getEl("status");
  if (!statusEl) return;
  statusEl.textContent = pesan;
  statusEl.className = "status-box";
  if (tipe === "error") statusEl.classList.add("error");
  if (tipe === "success") statusEl.classList.add("success");
}

function periksaAlamatKontrak() {
  if (!ethers.isAddress(CONTRACT_ADDRESS)) {
    throw new Error("Alamat CONTRACT_ADDRESS pada config.js belum valid.");
  }
}

async function periksaJaringan() {
  const net = await provider.getNetwork();
  const netEl = getEl("network");
  if (netEl) netEl.textContent = `${net.name} (chainId ${net.chainId})`;
  if (net.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`Jaringan salah (${net.name}). Pindahkan MetaMask ke Sepolia (11155111).`);
  }
}

async function hubungkanDompet() {
  const accEl = getEl("account");
  if (accEl) accEl.textContent = "Meminta izin MetaMask...";
  setStatus("Klik ikon ekstensi MetaMask di pojok kanan atas browser lalu pilih Connect / Hubungkan.", "info");

  try {
    if (!window.ethereum) {
      throw new Error("Ekstensi MetaMask tidak ditemukan. Pastikan membuka di Google Chrome yang terpasang MetaMask.");
    }
    periksaAlamatKontrak();

    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    await periksaJaringan();

    signer = await provider.getSigner();
    currentAccount = await signer.getAddress();
    contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

    if (accEl) accEl.textContent = currentAccount;
    setStatus("MetaMask terhubung! Memuat data dari Sepolia...", "info");
    await muatData();
  } catch (err) {
    if (accEl) accEl.textContent = "Belum terhubung";
    setStatus(`Gagal menghubungkan: ${err.reason || err.message}`, "error");
  }
}

async function muatData() {
  try {
    if (!contract) throw new Error("Hubungkan MetaMask terlebih dahulu.");
    await periksaJaringan();

    const [alamatBendahara, totalProposalBig, kasWei] = await Promise.all([
      contract.bendaharaUmum(),
      contract.jumlahProposal(),
      contract.saldoKas()
    ]);

    getEl("bendaharaAddress").textContent = alamatBendahara;
    getEl("saldoKas").textContent = `${ethers.formatEther(kasWei)} ETH (${kasWei} wei)`;
    getEl("jumlahProposal").textContent = totalProposalBig.toString();

    const roleBadge = getEl("roleBadge");
    if (currentAccount.toLowerCase() === alamatBendahara.toLowerCase()) {
      roleBadge.textContent = "Bendahara Umum (Admin)";
      roleBadge.className = "role-badge treasurer";
    } else {
      roleBadge.textContent = "Pengurus / Panitia Kegiatan";
      roleBadge.className = "role-badge member";
    }

    const total = Number(totalProposalBig);
    const tbody = getEl("daftarProposalBody");
    if (total === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-row">Belum ada proposal anggaran kegiatan yang diajukan.</td></tr>`;
    } else {
      const rows = [];
      for (let i = 0; i < total; i++) {
        const p = await contract.daftarProposal(i);
        const st = Number(p.status);

        let badgeHtml = `<span class="badge st-diajukan">Diajukan (0)</span>`;
        if (st === 1) badgeHtml = `<span class="badge st-dicairkan">Dicairkan (1)</span>`;
        if (st === 2) badgeHtml = `<span class="badge st-ditolak">Ditolak (2)</span>`;

        const pemohonShort = `${p.pemohon.slice(0, 6)}...${p.pemohon.slice(-4)}`;

        rows.push(`
          <tr>
            <td><strong>${i}</strong></td>
            <td>${p.namaKegiatan}</td>
            <td>${p.divisi}</td>
            <td>${ethers.formatEther(p.nominalDana)} ETH</td>
            <td>${badgeHtml}</td>
            <td class="mono" title="${p.pemohon}">${pemohonShort}</td>
          </tr>
        `);
      }
      tbody.innerHTML = rows.join("");
    }

    setStatus("Data kas dan proposal organisasi berhasil dimuat dari Sepolia.", "success");
  } catch (err) {
    setStatus(`Gagal membaca data: ${err.reason || err.message}`, "error");
  }
}

// Event klik tombol (aman untuk semua urutan muat halaman)
document.addEventListener("click", async (e) => {
  if (e.target.closest("#connectBtn")) {
    await hubungkanDompet();
  }
  if (e.target.closest("#refreshBtn")) {
    await muatData();
  }
  if (e.target.closest("#btnTolak")) {
    try {
      if (!contract) throw new Error("Hubungkan MetaMask terlebih dahulu.");
      const idProp = Number(getEl("idProposalProses").value);
      if (!Number.isInteger(idProp) || idProp < 0) throw new Error("ID Proposal tidak valid.");

      setStatus("Mengirim penolakan proposal. Konfirmasi di MetaMask...", "info");
      const tx = await contract.tolakProposal(BigInt(idProp));
      setStatus(`Transaksi dikirim! Hash: ${tx.hash}. Menunggu blok...`, "info");
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new Error("Penolakan proposal gagal.");

      await muatData();
      setStatus(`Proposal ID ${idProp} telah ditolak. Tx Hash: ${tx.hash}`, "success");
    } catch (err) {
      const msg = err.code === "ACTION_REJECTED" ? "Transaksi dibatalkan di MetaMask." : (err.reason || err.message);
      setStatus(`Gagal menolak proposal: ${msg}`, "error");
    }
  }
});

// Event submit form
document.addEventListener("submit", async (e) => {
  if (e.target.id === "formSetorKas") {
    e.preventDefault();
    try {
      if (!contract) throw new Error("Hubungkan MetaMask terlebih dahulu.");
      const milli = Number(getEl("nominalSetor").value);
      if (!Number.isInteger(milli) || milli < 1) throw new Error("Nominal setor kas minimal 1 milliether.");

      const nilaiWei = ethers.parseUnits(String(milli), 15);
      setStatus(`Menyetor ${ethers.formatEther(nilaiWei)} ETH ke kas. Konfirmasi di MetaMask...`, "info");
      const tx = await contract.setorKas({ value: nilaiWei });
      setStatus(`Transaksi dikirim! Hash: ${tx.hash}. Menunggu blok...`, "info");
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new Error("Transaksi setor kas gagal.");

      e.target.reset();
      await muatData();
      setStatus(`Setor kas berhasil! Tx Hash: ${tx.hash}`, "success");
    } catch (err) {
      const msg = err.code === "ACTION_REJECTED" ? "Transaksi dibatalkan di MetaMask." : (err.reason || err.message);
      setStatus(`Gagal setor kas: ${msg}`, "error");
    }
  }

  if (e.target.id === "formAjukanProposal") {
    e.preventDefault();
    try {
      if (!contract) throw new Error("Hubungkan MetaMask terlebih dahulu.");
      const kegiatan = getEl("namaKegiatan").value.trim();
      const divisi = getEl("divisi").value.trim();
      const danaMilli = Number(getEl("danaProposal").value);
      if (!kegiatan || !divisi || !Number.isInteger(danaMilli) || danaMilli < 1) {
        throw new Error("Lengkapi nama kegiatan, divisi, dan anggaran minimal 1 milliether.");
      }

      setStatus("Mengirim proposal ke blockchain. Konfirmasi di MetaMask...", "info");
      const tx = await contract.ajukanProposal(kegiatan, divisi, BigInt(danaMilli));
      setStatus(`Proposal dikirim! Hash: ${tx.hash}. Menunggu blok...`, "info");
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new Error("Pengajuan proposal gagal.");

      e.target.reset();
      await muatData();
      setStatus(`Proposal kegiatan berhasil diajukan! Tx Hash: ${tx.hash}`, "success");
    } catch (err) {
      const msg = err.code === "ACTION_REJECTED" ? "Transaksi dibatalkan di MetaMask." : (err.reason || err.message);
      setStatus(`Gagal mengajukan proposal: ${msg}`, "error");
    }
  }

  if (e.target.id === "formProsesProposal") {
    e.preventDefault();
    try {
      if (!contract) throw new Error("Hubungkan MetaMask terlebih dahulu.");
      const idProp = Number(getEl("idProposalProses").value);
      if (!Number.isInteger(idProp) || idProp < 0) throw new Error("ID Proposal tidak valid.");

      setStatus("Mencairkan dana kas ke dompet pemohon. Konfirmasi di MetaMask...", "info");
      const tx = await contract.setujuiDanCairkan(BigInt(idProp));
      setStatus(`Transaksi pencairan dikirim! Hash: ${tx.hash}. Menunggu blok...`, "info");
      const receipt = await tx.wait();
      if (receipt.status !== 1) throw new Error("Pencairan dana gagal.");

      await muatData();
      setStatus(`Dana proposal ID ${idProp} berhasil dicairkan! Tx Hash: ${tx.hash}`, "success");
    } catch (err) {
      const msg = err.code === "ACTION_REJECTED" ? "Transaksi dibatalkan di MetaMask." : (err.reason || err.message);
      setStatus(`Pencairan dana gagal: ${msg}`, "error");
    }
  }
});

// Otomatis sambungkan jika akun sudah pernah diberi izin sebelumnya
if (window.ethereum) {
  window.ethereum.request({ method: "eth_accounts" }).then((accounts) => {
    if (accounts && accounts.length > 0) {
      hubungkanDompet();
    }
  });

  window.ethereum.on("accountsChanged", () => {
    contract = null;
    signer = null;
    getEl("account").textContent = "Akun berubah — hubungkan ulang";
    getEl("roleBadge").textContent = "Perlu koneksi ulang";
    getEl("roleBadge").className = "role-badge";
    setStatus("Akun MetaMask berubah. Klik 'Hubungkan MetaMask' kembali.", "info");
  });

  window.ethereum.on("chainChanged", () => {
    contract = null;
    signer = null;
    setStatus("Jaringan berubah. Klik 'Hubungkan MetaMask' kembali.", "error");
  });
}