"use strict";

const form = document.querySelector("#download-form");
const urlInput = document.querySelector("#media-url");
const clearButton = document.querySelector("#clear-url");
const submitButton = document.querySelector("#submit-button");
const jobPanel = document.querySelector("#job-panel");
const jobIndicator = document.querySelector("#job-indicator");
const jobTitle = document.querySelector("#job-title");
const jobMessage = document.querySelector("#job-message");
const jobPercent = document.querySelector("#job-percent");
const progressBar = document.querySelector("#progress-bar");
const progressTrack = document.querySelector("#progress-track");
const fileLink = document.querySelector("#file-link");
const cancelButton = document.querySelector("#cancel-button");
const resetButton = document.querySelector("#reset-button");
const jobError = document.querySelector("#job-error");
let activeJobId = null;
let pollTimer = null;
let busy = false;

function setBusy(value) {
  busy = value;
  submitButton.disabled = value;
  submitButton.querySelector(".button-label").textContent = value ? "Procesando…" : "Preparar descarga";
  form.querySelectorAll("input").forEach((input) => { input.disabled = value; });
  cancelButton.hidden = !value;
  resetButton.hidden = value;
}

function showJob() {
  jobPanel.hidden = false;
  jobError.hidden = true;
  jobError.textContent = "";
  fileLink.hidden = true;
  progressTrack.hidden = false;
  progressBar.style.width = "0%";
  jobPercent.textContent = "";
}

function renderJob(job) {
  jobMessage.textContent = job.message || "Procesando…";
  if (job.progress !== null && job.progress !== undefined) {
    const amount = Math.max(0, Math.min(100, Number(job.progress)));
    progressBar.style.width = `${amount}%`;
    jobPercent.textContent = `${Math.floor(amount)}%`;
  }

  if (job.status === "complete") {
    setBusy(false);
    jobIndicator.className = "job-indicator is-success";
    jobTitle.textContent = "Tu archivo está listo";
    jobMessage.textContent = job.filename || "Descarga preparada para tu dispositivo.";
    progressBar.style.width = "100%";
    jobPercent.textContent = "100%";
    fileLink.href = job.downloadUrl;
    fileLink.download = job.filename || "descarga";
    fileLink.hidden = false;
    cancelButton.hidden = true;
    resetButton.hidden = false;
    clearInterval(pollTimer);
    pollTimer = null;
    return;
  }

  if (["failed", "cancelled", "delivered"].includes(job.status)) {
    setBusy(false);
    jobIndicator.className = job.status === "failed" ? "job-indicator is-error" : "job-indicator is-success";
    jobTitle.textContent = job.status === "failed" ? "No se pudo completar" : "Listo";
    jobMessage.textContent = job.message || "Puedes preparar otra descarga.";
    progressTrack.hidden = job.status !== "failed";
    cancelButton.hidden = true;
    resetButton.hidden = false;
    if (job.status === "failed") {
      jobError.textContent = job.message || "Comprueba el enlace e inténtalo otra vez.";
      jobError.hidden = false;
    }
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollJob() {
  if (!activeJobId) return;
  try {
    const response = await fetch(`/api/jobs/${activeJobId}`, { cache: "no-store" });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "La descarga ya no está disponible.");
    renderJob(job);
  } catch (error) {
    clearInterval(pollTimer);
    pollTimer = null;
    setBusy(false);
    jobIndicator.className = "job-indicator is-error";
    jobTitle.textContent = "Se perdió la conexión";
    jobMessage.textContent = "Envía el enlace otra vez para iniciar una nueva descarga.";
    jobError.textContent = error.message;
    jobError.hidden = false;
    resetButton.hidden = false;
  }
}

urlInput.addEventListener("input", () => { clearButton.hidden = urlInput.value.length === 0; });
clearButton.addEventListener("click", () => { urlInput.value = ""; clearButton.hidden = true; urlInput.focus(); });

form.querySelectorAll('input[name="kind"]').forEach((input) => {
  input.addEventListener("change", () => {
    form.querySelectorAll(".format-option").forEach((option) => option.classList.remove("selected"));
    input.closest(".format-option").classList.add("selected");
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const selected = form.querySelector('input[name="kind"]:checked');
  showJob();
  setBusy(true);
  jobIndicator.className = "job-indicator is-running";
  jobTitle.textContent = selected.value === "audio" ? "Preparando tu audio" : "Preparando tu video";
  jobMessage.textContent = "Validando el enlace…";
  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: urlInput.value.trim(), kind: selected.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo iniciar la descarga.");
    activeJobId = result.id;
    renderJob(result);
    pollTimer = setInterval(pollJob, 1000);
  } catch (error) {
    setBusy(false);
    jobIndicator.className = "job-indicator is-error";
    jobTitle.textContent = "Revisa el enlace";
    jobMessage.textContent = error.message;
    jobError.textContent = error.message;
    jobError.hidden = false;
    resetButton.hidden = false;
  }
});

cancelButton.addEventListener("click", async () => {
  if (!activeJobId) return;
  cancelButton.disabled = true;
  try { await fetch(`/api/jobs/${activeJobId}`, { method: "DELETE" }); } catch { /* polling reports connection errors */ }
  await pollJob();
  cancelButton.disabled = false;
});

resetButton.addEventListener("click", () => {
  clearInterval(pollTimer);
  pollTimer = null;
  activeJobId = null;
  jobPanel.hidden = true;
  jobError.hidden = true;
  fileLink.hidden = true;
  urlInput.disabled = false;
  form.querySelectorAll("input").forEach((input) => { input.disabled = false; });
  urlInput.focus();
});

fileLink.addEventListener("click", () => {
  jobMessage.textContent = "La descarga comenzará en tu navegador.";
  window.setTimeout(pollJob, 500);
});
