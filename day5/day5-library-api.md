# Library Books REST API Design

Base path: `/api`. All request and response bodies are JSON.

## Endpoints

### 1. List all books
- Method:`GET`
- Path: `/api/books`
- Description: Returns a list of all books in the library.
- Success status: `200 OK`

### 2. Get one book
- Method: `GET`
- Path: `/api/books/{id}`
- Description: Returns the single book with the given id.
- Success status: `200 OK`

### 3. Create a book
- Method: `POST`
- Path: `/api/books`
- Description: Adds a new book to the library.
- Example request body:
```json
{
  "title": "Things Fall Apart",
  "author": "Chinua Achebe",
  "isbn": "9780385474542",
  "year": 1958
}
```
- Success status: `201 Created`

### 4. Update a book
- Method: `PUT`
- Path:`/api/books/{id}`
- Description: Replaces the details of an existing book.
- Example request body:
```json
{
  "title": "Things Fall Apart",
  "author": "Chinua Achebe",
  "isbn": "9780385474542",
  "year": 1959
}
```
- Success status: `200 OK`

### 5. Delete a book
- Method: `DELETE`
- Path: `/api/books/{id}`
- Description: Removes the book with the given id from the library.
- **Success status: `204 No Content`

### 6. List books by an author
- Method: `GET`
- Path: `/api/books?author=Chinua%20Achebe`
- Description: Returns only the books written by the author given in the `author` query parameter.
- Success status: `200 OK`

## Error codes

### 400 Bad Request
The request is invalid or malformed.
- Example: `POST /api/books` with a body that is missing the required `title` field, or with `"year": "abc"` instead of a number.

### 404 Not Found
The requested resource does not exist.
- Example: `GET /api/books/9999` when no book with id 9999 exists (the same applies to `PUT` and `DELETE` on a missing id).

