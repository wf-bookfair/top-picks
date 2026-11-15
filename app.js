const SUBMISSION_URL =
  "https://script.google.com/macros/s/AKfycbxv0Oc-AKY67Iuy6uCBLQ3FZCOD7MoZU779gobi1Tuhmd0yKxb72oB31SBUmZE_G4qR/exec";
const MAX_BOOKS = 5;
const MAX_TITLE_WORDS = 15;

const state = {
  books: [],
  scanner: null,
  scannerKind: null,
  scanning: false,
  processing: false,
  submitted: false,
};

const elements = {
  studentForm: document.querySelector("#student-form"),
  firstName: document.querySelector("#first-name"),
  lastName: document.querySelector("#last-name"),
  grade: document.querySelector("#grade"),
  reader: document.querySelector("#reader"),
  placeholder: document.querySelector("#scanner-placeholder"),
  scanButton: document.querySelector("#scan-button"),
  cancelScanButton: document.querySelector("#cancel-scan-button"),
  status: document.querySelector("#status"),
  counter: document.querySelector("#counter"),
  booksSection: document.querySelector("#books-section"),
  bookList: document.querySelector("#book-list"),
  submitButton: document.querySelector("#submit-button"),
  submitHint: document.querySelector("#submit-hint"),
  resetButton: document.querySelector("#reset-button"),
  manualForm: document.querySelector("#manual-form"),
  manualTitle: document.querySelector("#manual-title"),
  clearTitle: document.querySelector("#clear-title"),
  scanGuide: document.querySelector("#scan-guide"),
  intro: document.querySelector("#intro"),
  stationReset: document.querySelector("#station-reset"),
  addBookButton: document.querySelector("#add-book-button"),
  wordCount: document.querySelector("#word-count"),
  studentError: document.querySelector("#student-error"),
  addedFlash: document.querySelector("#added-flash"),
  entryView: document.querySelector("#entry-view"),
  reviewView: document.querySelector("#review-view"),
  reviewStudent: document.querySelector("#review-student"),
  reviewList: document.querySelector("#review-list"),
  confirmSendButton: document.querySelector("#confirm-send-button"),
  backButton: document.querySelector("#back-button"),
  sendError: document.querySelector("#send-error"),
  doneView: document.querySelector("#done-view"),
  doneStudent: document.querySelector("#done-student"),
  doneList: document.querySelector("#done-list"),
};

elements.scanButton.addEventListener("click", startScanner);
elements.cancelScanButton.addEventListener("click", stopScanner);
elements.submitButton.addEventListener("click", showReview);
elements.confirmSendButton.addEventListener("click", sendTopPicks);
elements.backButton.addEventListener("click", showEntry);
elements.resetButton.addEventListener("click", resetForNextStudent);
elements.stationReset.addEventListener("click", resetForNextStudent);
elements.manualForm.addEventListener("submit", handleManualEntry);
elements.manualTitle.addEventListener("input", () => {
  autoGrow(elements.manualTitle);
  updateTitleState();
});
elements.manualTitle.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (!elements.addBookButton.disabled) elements.manualForm.requestSubmit();
  }
});
elements.clearTitle.addEventListener("click", () => {
  elements.manualTitle.value = "";
  autoGrow(elements.manualTitle);
  updateTitleState();
  elements.manualTitle.focus();
});
elements.lastName.addEventListener("input", () => {
  elements.lastName.value = elements.lastName.value.toUpperCase();
});
elements.studentForm.addEventListener("input", handleStudentChange);
elements.studentForm.addEventListener("change", handleStudentChange);
elements.studentForm.addEventListener("focusout", () => showStudentError(true));
window.addEventListener("resize", () => document.querySelectorAll(".auto-grow").forEach(autoGrow));

function normalizeIsbn(value) {
  return String(value).replace(/[^0-9X]/gi, "").toUpperCase();
}

function isValidIsbnLength(isbn) {
  return isbn.length === 10 || isbn.length === 13;
}

async function startScanner() {
  if (state.books.length >= MAX_BOOKS) return;
  if (isIosDevice()) {
    await startZxingScanner();
    return;
  }
  await startHtml5Scanner();
}

function isIosDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function showScanner() {
  state.scanning = true;
  elements.reader.hidden = false;
  elements.scanGuide.hidden = false;
  elements.placeholder.hidden = true;
  elements.scanButton.hidden = true;
  elements.cancelScanButton.hidden = false;
}

async function startZxingScanner() {
  if (typeof ZXingBrowser === "undefined") {
    setStatus("The scanner could not load. Check your connection and try again.", true);
    return;
  }

  setStatus("Allow camera access when your browser asks.");
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  elements.reader.append(video);

  const reader = new ZXingBrowser.BrowserMultiFormatReader();
  reader.possibleFormats = [
    ZXingBrowser.BarcodeFormat.EAN_13,
    ZXingBrowser.BarcodeFormat.EAN_8,
    ZXingBrowser.BarcodeFormat.UPC_A,
    ZXingBrowser.BarcodeFormat.UPC_E,
  ];
  state.scannerKind = "zxing";
  state.scanner = { reader, controls: null };
  showScanner();

  try {
    const controls = await reader.decodeFromConstraints(
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      video,
      (result, error, callbackControls) => {
        if (state.scannerKind === "zxing" && state.scanner) {
          state.scanner.controls = callbackControls;
        }
        if (result) handleScanSuccess(result.getText());
      }
    );
    if (state.scannerKind === "zxing" && state.scanner) {
      state.scanner.controls = controls;
    } else {
      controls.stop();
    }
  } catch (error) {
    console.error(error);
    await resetScanner();
    setStatus("Camera access failed. Check Safari camera permissions or type the title below.", true);
  }
}

async function startHtml5Scanner() {
  if (typeof Html5Qrcode === "undefined") {
    setStatus("The scanner could not load. Check your connection and try again.", true);
    return;
  }

  setStatus("Allow camera access when your browser asks.");
  state.scannerKind = "html5";
  state.scanner = new Html5Qrcode("reader");
  showScanner();

  try {
    await state.scanner.start(
      { facingMode: "environment" },
      {
        fps: 12,
        qrbox: (width, height) => ({
          width: Math.min(width * 0.88, 420),
          height: Math.min(height * 0.34, 170),
        }),
        aspectRatio: 1.777,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
        ],
      },
      handleScanSuccess,
      () => {}
    );
  } catch (error) {
    console.error(error);
    await resetScanner();
    setStatus("Camera access failed. Check browser camera permissions or type the title below.", true);
  }
}

async function handleScanSuccess(decodedText) {
  if (state.processing) return;
  state.processing = true;
  const isbn = normalizeIsbn(decodedText);

  if (!isValidIsbnLength(isbn)) {
    state.processing = false;
    setStatus("That barcode is not an ISBN. Try the barcode next to the ISBN number.", true);
    return;
  }

  await stopScanner();
  await addBook(isbn);
  state.processing = false;
}

async function stopScanner() {
  if (state.scanner && state.scanning) {
    try {
      if (state.scannerKind === "zxing") {
        state.scanner.controls?.stop();
      } else {
        await state.scanner.stop();
      }
    } catch (error) {
      console.warn("Could not stop scanner cleanly", error);
    }
  }
  await resetScanner();
}

async function resetScanner() {
  if (state.scanner && state.scannerKind === "html5") {
    try {
      state.scanner.clear();
    } catch (error) {
      console.warn("Could not clear scanner", error);
    }
  }

  state.scanner = null;
  state.scannerKind = null;
  state.scanning = false;
  elements.scanGuide.hidden = true;
  replaceReader();
  elements.placeholder.hidden = state.books.length >= MAX_BOOKS;
  elements.scanButton.hidden = state.books.length >= MAX_BOOKS;
  elements.cancelScanButton.hidden = true;
}

function replaceReader() {
  const reader = document.createElement("div");
  reader.id = "reader";
  reader.className = "reader";
  reader.hidden = true;
  elements.reader.replaceWith(reader);
  elements.reader = reader;
}

async function handleManualEntry(event) {
  event.preventDefault();
  if (state.books.length >= MAX_BOOKS) {
    setStatus("Five books are already in the list.", true);
    return;
  }
  updateTitleState();
  if (elements.addBookButton.disabled) return;

  const title = elements.manualTitle.value.trim().replace(/\s+/g, " ");
  state.books.push({ isbn: "", title, authors: "" });
  elements.manualForm.reset();
  autoGrow(elements.manualTitle);
  renderBooks();
  setStatus(`Added “${title}”.`);
}

async function addBook(isbn) {
  if (state.books.length >= MAX_BOOKS) return;
  if (state.books.some((book) => book.isbn === isbn)) {
    setStatus("Already on your list!", true);
    return;
  }

  setStatus("Looking up the book title…");
  elements.scanButton.disabled = true;

  const book = await lookupBook(isbn);
  state.books.push({
    isbn,
    title: book?.title || "",
    authors: book?.authors || "",
  });

  renderBooks();
  flashAdded();
  elements.scanButton.disabled = false;
  setStatus(
    book?.title
      ? `Found “${book.title}”${book.authors ? ` by ${book.authors}` : ""}.`
      : "No title was found. Type it in the list below.",
    !book?.title
  );
}

async function lookupBook(isbn) {
  try {
    const key = `ISBN:${isbn}`;
    const openLibraryResponse = await fetch(
      `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`
    );
    if (openLibraryResponse.ok) {
      const openLibraryData = await openLibraryResponse.json();
      const record = openLibraryData[key];
      if (record?.title) {
        return {
          title: record.title,
          authors: record.authors?.map((author) => author.name).join(", ") || "",
        };
      }
    }
  } catch (error) {
    console.warn("Open Library lookup failed", error);
  }

  try {
    const googleResponse = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&maxResults=1`
    );
    if (googleResponse.ok) {
      const googleData = await googleResponse.json();
      const volume = googleData.items?.[0]?.volumeInfo;
      if (volume?.title) {
        return {
          title: volume.title,
          authors: volume.authors?.join(", ") || "",
        };
      }
    }
  } catch (error) {
    console.warn("Google Books lookup failed", error);
  }

  return null;
}

function renderBooks() {
  elements.bookList.replaceChildren();

  state.books.forEach((book, index) => {
    const item = document.createElement("li");
    item.className = "book";

    const number = document.createElement("span");
    number.className = "book-number";
    number.textContent = String(index + 1);

    const details = document.createElement("div");
    const title = document.createElement("textarea");
    title.className = "book-title auto-grow";
    title.rows = 1;
    title.value = book.title;
    title.placeholder = "Type book title";
    title.setAttribute("aria-label", `Book ${index + 1} title`);
    title.addEventListener("input", (event) => {
      state.books[index].title = event.target.value.replace(/\n/g, " ");
      autoGrow(event.target);
      updateSubmitButton();
    });

    details.append(title);
    if (book.isbn) {
      const isbn = document.createElement("span");
      isbn.className = "book-isbn";
      isbn.textContent = `ISBN ${book.isbn}`;
      details.append(isbn);
    }

    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove book ${index + 1}`);
    remove.addEventListener("click", () => {
      state.books.splice(index, 1);
      renderBooks();
      setStatus("");
    });

    item.append(number, details, remove);
    elements.bookList.append(item);
  });

  elements.counter.textContent = `${state.books.length} / ${MAX_BOOKS}`;
  elements.booksSection.hidden = state.books.length === 0;

  if (state.books.length >= MAX_BOOKS) {
    elements.scanButton.hidden = true;
    elements.placeholder.hidden = true;
  } else if (state.scanning) {
    elements.scanButton.hidden = true;
    elements.placeholder.hidden = true;
  } else {
    elements.scanButton.hidden = false;
    elements.placeholder.hidden = state.scanning;
    elements.scanButton.innerHTML =
      state.books.length === 0
        ? '<span aria-hidden="true">▣</span> Scan first book'
        : '<span aria-hidden="true">＋</span> Scan another book';
  }

  requestAnimationFrame(() => elements.bookList.querySelectorAll(".auto-grow").forEach(autoGrow));
  updateTitleState();
  updateSubmitButton();
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function updateTitleState() {
  const text = elements.manualTitle.value;
  const words = countWords(text);
  const tooMany = words > MAX_TITLE_WORDS;
  elements.wordCount.textContent = `${words} / ${MAX_TITLE_WORDS} words`;
  elements.clearTitle.hidden = text.length === 0;
  elements.wordCount.classList.toggle("error", tooMany);
  elements.addBookButton.disabled =
    text.trim().length < 3 || tooMany || state.books.length >= MAX_BOOKS;
}

function flashAdded() {
  const flash = elements.addedFlash;
  flash.classList.remove("show");
  void flash.offsetWidth;
  flash.classList.add("show");
}

function studentProblems() {
  const problems = [];
  if (elements.firstName.value.trim().length < 2) problems.push("first name");
  if (!/^\p{L}$/u.test(elements.lastName.value.trim())) problems.push("last name initial");
  if (!elements.grade.value) problems.push("grade");
  return problems;
}

function handleStudentChange() {
  showStudentError(false);
  updateSubmitButton();
}

function showStudentError(onLeave) {
  const name = elements.firstName.value.trim();
  const initial = elements.lastName.value.trim();
  let message = "";
  if (name && name.length < 2) message = "Name must be at least 2 characters";
  else if (initial && !/^\p{L}$/u.test(initial)) message = "Last name initial must be a letter";
  if (onLeave || !message) elements.studentError.textContent = message;
}

function joinList(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function updateSubmitButton() {
  const missing = studentProblems();
  if (state.books.length === 0) missing.push("at least one book");
  else if (state.books.some((book) => !book.title.trim())) missing.push("a title for every book");
  elements.submitButton.disabled = missing.length > 0;
  elements.submitHint.textContent = missing.length ? `To send, add your ${joinList(missing)}.` : "";
}

function fillSummary(details, list) {
  details.replaceChildren();
  [
    ["Name", `${elements.firstName.value.trim()} ${elements.lastName.value.trim().toUpperCase()}.`],
    ["Grade", elements.grade.value],
  ].forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    details.append(term, detail);
  });
  list.replaceChildren(
    ...state.books.map((book) => {
      const item = document.createElement("li");
      item.textContent = formatBookEntry(book);
      return item;
    })
  );
}

function showView(view) {
  elements.intro.hidden = view !== "entry";
  elements.entryView.hidden = view !== "entry";
  elements.reviewView.hidden = view !== "review";
  elements.doneView.hidden = view !== "done";
}

async function showReview() {
  updateSubmitButton();
  if (elements.submitButton.disabled) return;
  await stopScanner();
  fillSummary(elements.reviewStudent, elements.reviewList);
  elements.sendError.textContent = "";
  showView("review");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showEntry() {
  showView("entry");
  elements.booksSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function sendTopPicks() {
  if (state.submitted) return;
  const payload = new URLSearchParams({
    firstName: elements.firstName.value.trim(),
    lastName: elements.lastName.value.trim().toUpperCase(),
    grade: elements.grade.value,
  });
  state.books.forEach((book, index) => {
    payload.set(`book${index + 1}`, formatBookEntry(book));
  });

  elements.confirmSendButton.disabled = true;
  elements.backButton.disabled = true;
  elements.confirmSendButton.textContent = "Sending…";
  elements.sendError.textContent = "";

  try {
    await fetch(SUBMISSION_URL, {
      method: "POST",
      mode: "no-cors",
      body: payload,
    });
    state.submitted = true;
    fillSummary(elements.doneStudent, elements.doneList);
    showView("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    elements.sendError.textContent = "Your top picks could not be sent. Check the internet and try again.";
  } finally {
    elements.confirmSendButton.disabled = false;
    elements.backButton.disabled = false;
    elements.confirmSendButton.textContent = "Send my top picks";
  }
}

async function resetForNextStudent() {
  await stopScanner();
  state.books = [];
  state.submitted = false;
  elements.studentForm.reset();
  elements.grade.value = "";
  elements.manualForm.reset();
  elements.studentError.textContent = "";
  autoGrow(elements.manualTitle);
  setStatus("");
  renderBooks();
  showView("entry");
  window.scrollTo({ top: 0, behavior: "smooth" });
  elements.firstName.focus();
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function formatBookEntry(book) {
  const title = book.title?.trim();
  const authors = book.authors?.trim();
  if (!title) return "";
  return authors ? `${title} — ${authors}` : title;
}

renderBooks();
autoGrow(elements.manualTitle);

window.isbnScanner = {
  normalizeIsbn,
  isValidIsbnLength,
  lookupBook,
  formatBookEntry,
};
