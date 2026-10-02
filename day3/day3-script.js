let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" },
];

// Returns notes whose text contains the word, ignoring case
function searchNotes(word) {
  return notes.filter(note =>
    note.text.toLowerCase().includes(word.toLowerCase())
  );
}

// Returns the note with the most characters, or null if there are none
function longestNote() {
  if (notes.length === 0) {
    return null;
  }

  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

// Returns an object counting notes per category
function countByCategory() {
  const counts = {};

  for (const note of notes) {
    if (counts[note.category]) {
      counts[note.category] += 1;
    } else {
      counts[note.category] = 1;
    }
  }

  return counts;
}

// Returns a sentence such as "5 notes: 2 personal, 1 work, 2 study."
function getSummary() {
  const counts = countByCategory();
  const total = notes.length;
  const noteWord = total === 1 ? "note" : "notes";

  if (total === 0) {
    return `0 ${noteWord}.`;
  }

  const parts = [];
  for (const category of ["personal", "work", "study"]) {
    if (counts[category]) {
      parts.push(`${counts[category]} ${category}`);
    }
  }

  return `${total} ${noteWord}: ${parts.join(", ")}.`;
}

// Lowercases, trims, and collapses extra spaces
function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// Returns true if a note with the same text already exists
function isDuplicate(text) {
  const normalized = normalize(text);
  return notes.some(note => normalize(note.text) === normalized);
}

// Adds a note if valid; returns true if added, false otherwise
function addNote(text, category) {
  const validCategories = ["personal", "work", "study"];
  const cleanText = text.trim();

  if (cleanText.length < 1 || cleanText.length > 200) {
    console.log("Rejected: text must be between 1 and 200 characters.");
    return false;
  }

  if (!validCategories.includes(category)) {
    console.log("Rejected: category must be personal, work, or study.");
    return false;
  }

  if (isDuplicate(cleanText)) {
    console.log("Rejected: a note with this text already exists.");
    return false;
  }

  const newNote = {
    id: notes.length > 0 ? Math.max(...notes.map(n => n.id)) + 1 : 1,
    text: cleanText,
    category: category,
  };

  notes.push(newNote);
  console.log("Note added successfully.");
  return true;
}

// ================= TESTS =================
// Edge cases that need a different array swap it in, then restore it.
const originalNotes = notes;

// --- searchNotes ---
console.log(searchNotes("milk")); // expected: [{ id: 1, text: "Buy milk and bread", category: "personal" }]
console.log(searchNotes("MILK")); // expected: same result as above (ignores case)
console.log(searchNotes("xyz")); // expected: [] (no matches)

// --- longestNote ---
console.log(longestNote()); // expected: { id: 3, text: "Email the project report to Grace", category: "work" }
console.log(longestNote().text.length); // expected: 33
notes = [];
console.log(longestNote()); // expected: null (empty array)
notes = originalNotes;

// --- countByCategory ---
console.log(countByCategory()); // expected: { personal: 2, study: 2, work: 1 }
notes = [];
console.log(countByCategory()); // expected: {} (empty array)
notes = originalNotes;

// --- getSummary ---
console.log(getSummary()); // expected: "5 notes: 2 personal, 1 work, 2 study."
notes = [{ id: 1, text: "Only note", category: "work" }];
console.log(getSummary()); // expected: "1 note: 1 work." (singular "note")
notes = originalNotes;

// --- isDuplicate ---
console.log(isDuplicate("call mum")); // expected: true (case-insensitive match)
console.log(isDuplicate("  CALL    mum  ")); // expected: true (ignores case and extra spaces)
console.log(isDuplicate("Something totally new")); // expected: false

// --- addNote (last, because it changes the notes array) ---
console.log(addNote("Go for a run", "personal")); // expected: "Note added successfully." then true
console.log(addNote("Call mum", "personal")); // expected: "Rejected: a note with this text already exists." then false
console.log(addNote("   ", "personal")); // expected: "Rejected: text must be between 1 and 200 characters." then false
console.log(addNote("a".repeat(201), "work")); // expected: "Rejected: text must be between 1 and 200 characters." then false
console.log(addNote("Plan trip", "hobby")); // expected: "Rejected: category must be personal, work, or study." then false
