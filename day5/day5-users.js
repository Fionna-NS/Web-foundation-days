const API_URL = "https://jsonplaceholder.typicode.com/users";

const loadButton = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusEl = document.getElementById("status");
const usersList = document.getElementById("users-list");

let allUsers = [];

function renderUsers(users) {
  usersList.textContent = "";

  users.forEach((user) => {
    const li = document.createElement("li");

    const name = document.createElement("strong");
    name.textContent = user.name;

    const email = document.createElement("p");
    email.textContent = "Email: " + user.email;

    const city = document.createElement("p");
    city.textContent = "City: " + user.address.city;

    const company = document.createElement("p");
    company.textContent = "Company: " + user.company.name;

    li.append(name, email, city, company);
    usersList.appendChild(li);
  });
}

async function loadUsers() {
  statusEl.textContent = "Loading users...";
  loadButton.disabled = true;

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error("Request failed with status " + response.status);
    }

    allUsers = await response.json();
    applyFilter();
    statusEl.textContent = "Loaded " + allUsers.length + " users successfully.";
  } catch (error) {
    statusEl.textContent = "Error: could not load users. " + error.message;
  } finally {
    loadButton.disabled = false;
  }
}

function applyFilter() {
  const text = filterInput.value.trim().toLowerCase();
  const filtered = allUsers.filter((user) =>
    user.name.toLowerCase().includes(text)
  );
  renderUsers(filtered);

  if (allUsers.length > 0 && filtered.length === 0) {
    statusEl.textContent = "No users match your filter.";
  } else if (allUsers.length > 0) {
    statusEl.textContent = "Showing " + filtered.length + " of " + allUsers.length + " users.";
  }
}

loadButton.addEventListener("click", loadUsers);
filterInput.addEventListener("input", applyFilter);

