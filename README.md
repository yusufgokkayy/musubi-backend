# Kotoba API

Kotoba API is a RESTful backend service for a Japanese vocabulary learning application. It provides authentication, daily study sessions, spaced repetition (SM-2), progress tracking, streak management, and JLPT-based vocabulary management.

## Features

- User Authentication
  - Register
  - Login
  - Logout
  - Refresh Token
  - Email Verification
  - Forgot Password / Reset Password
  - Change Password
  - Delete Account

- User Management
  - Get current user
  - Update profile
  - Upload profile image

- Japanese Vocabulary
  - JLPT level filtering (N5–N1)
  - Search words
  - Pagination
  - CRUD operations

- Daily Study
  - Daily word generation
  - Daily study sessions
  - Home summary
  - Session history

- Learning System
  - SM-2 Spaced Repetition Algorithm
  - Review scheduling
  - Learning statistics
  - Progress tracking
  - Study streak tracking

---

## Tech Stack

- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT Authentication
- bcrypt
- Nodemailer
- Multer
- dotenv

---

## Project Structure

```
config/
middlewares/
models/
modules/
    auth/
    home/
    progress/
    session/
    streak/
    user/
    userword/
    word/
routes/
seeds/
utils/
server.js
```

---

## Installation

Clone the repository

```bash
git clone https://github.com/yourusername/kotoba-api.git
```

Install dependencies

```bash
npm install
```

Create a `.env` file

```env
PORT=5000

MONGO_URI=your_mongodb_connection

JWT_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret

JWT_EXPIRE=15m
JWT_REFRESH_EXPIRE=7d

EMAIL_HOST=
EMAIL_PORT=
EMAIL_USERNAME=
EMAIL_PASSWORD=
EMAIL_FROM=
```

Start the development server

```bash
npm run dev
```

or

```bash
npm start
```

---

## API Base URL

```
http://localhost:5000/api
```

---

# Authentication

| Method | Endpoint |
|---------|----------|
| POST | /auth/register |
| POST | /auth/login |
| POST | /auth/logout |
| POST | /auth/refresh-token |
| GET | /auth/me |
| GET | /auth/verify-email/:token |
| POST | /auth/forgot-password |
| PUT | /auth/reset-password/:token |
| PUT | /auth/change-password |
| DELETE | /auth/delete-account |

---

# User

| Method | Endpoint |
|---------|----------|
| GET | /user/me |
| PUT | /user/profile |
| POST | /user/profile-image |

---

# Words

| Method | Endpoint |
|---------|----------|
| GET | /words |
| GET | /words/:id |
| GET | /words/search |
| POST | /words |
| PUT | /words/:id |
| DELETE | /words/:id |

Supports

- JLPT filtering
- Pagination
- Search

Example

```
GET /words?jlptLevel=N5&page=1&limit=20
```

---

# User Words

Daily learning endpoints.

| Method | Endpoint |
|---------|----------|
| GET | /userword/today |
| POST | /userword/answer |
| GET | /userword/stats |

Example

```
GET /userword/today?jlptLevel=N5
```

Submit answer

```json
{
    "wordId": "...",
    "result": "correct"
}
```

Available results

- correct
- wrong
- empty

---

# Study Sessions

| Method | Endpoint |
|---------|----------|
| POST | /session/start |
| POST | /session/end |
| GET | /session/today |
| GET | /session/history |

---

# Progress

Tracks learning progress for each JLPT level.

---

# Streak

Tracks

- Current streak
- Longest streak
- Last study date

---

# Home

Provides dashboard information.

Example response includes

- Today's session
- Current streak
- Progress
- Review count
- Learning statistics

---

# Learning Algorithm

Kotoba uses the **SM-2 Spaced Repetition Algorithm**.

Each submitted answer updates:

- Ease Factor
- Interval
- Repetitions
- Next Review Date

Answer quality mapping

| Result | Quality |
|---------|----------|
| correct | 4 |
| empty | 2 |
| wrong | 1 |

This allows words to be scheduled dynamically according to user performance.

---

# Seed Data

The project includes seed scripts for importing JLPT vocabulary.

Example

```bash
node seeds/seed-n5.js
```

---

# Authentication

Protected routes require

```
Authorization: Bearer ACCESS_TOKEN
```

Access tokens are refreshed using the Refresh Token endpoint.

---

# Response Format

Successful responses

```json
{
    "success": true,
    "data": {}
}
```

Error responses

```json
{
    "success": false,
    "message": "Error message"
}
```

---

# Future Improvements

- Audio pronunciation
- Example sentence audio
- Multiple-choice quizzes
- Leaderboard
- Kanji writing practice
- Admin dashboard
- Push notifications
- Mobile application support

---

# License

This project is licensed under the MIT License.