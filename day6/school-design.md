
## Tables

students – one row per student. It stores `id` (primary key), `first_name`, `last_name` and `email`. The email is `NOT NULL` and `UNIQUE` so two students cannot share an address.

courses – one row per course. It stores `id` (primary key), `title` and `credits`. Course details live here once, however many students take the course.

enrolments – one row per student-on-course. It stores `id` (primary key), `student_id` and `course_id` (both foreign keys, `NOT NULL`), `enrolled_on` and `grade`. The grade is nullable because it is unknown until the course has been marked. A `UNIQUE (student_id, course_id)` constraint stops the same student enrolling on the same course twice.

## Relationships

- students → enrolments is one-to-many. One student can have many enrolments, but each enrolment belongs to exactly one student.
- courses → enrolments is one-to-many. One course can have many enrolments, but each enrolment is for exactly one course.
- students ↔ courses is many-to-many. A student takes many courses and a course has many students.

A relational table cannot hold a list of values in one column (for example, a `course_ids` column on `students`), because that breaks querying, joins and foreign key checks. The `enrolments` table is the join table that solves this: it turns one many-to-many relationship into two one-to-many relationships. It also gives a natural home for data about the pairing itself, such as the grade and enrolment date, which belongs to neither the student nor the course alone.

## Index

I would add an index on `enrolments(course_id)`:

```sql
CREATE INDEX idx_enrolments_course_id ON enrolments(course_id);
```

The `UNIQUE (student_id, course_id)` constraint already creates an index that speeds up lookups by student. Nothing does the same for lookups by course, so queries like "all students on a course" and "students per course" would have to scan the whole table as it grows. An index on `course_id` makes those fast, and also speeds up foreign key checks when a course is deleted.

## SQL or NoSQL?

I would choose SQL for this system. The data is naturally relational and highly structured: students, courses and enrolments have fixed fields and clear links between them, and the important questions are join-style queries such as who is on which course and how many students each course has. A relational database enforces integrity for me, with foreign keys preventing enrolments for students or courses that do not exist, and unique constraints preventing duplicates, and it supports transactions so that changes such as enrolling and updating grades stay consistent. NoSQL would be worth considering if the system had to scale to enormous volumes, store loosely structured data that varies from record to record, or serve one very simple access pattern, but a school's data is modest in size and its relationships are the whole point, so the guarantees and flexibility of SQL fit much better.

