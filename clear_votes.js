const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbPath = './database/jukebox.db';

// Check if database file exists
if (!fs.existsSync(dbPath)) {
  console.log('Database file does not exist. Nothing to clear.');
  process.exit(0);
}

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    if (err.code === 'SQLITE_BUSY') {
      console.error('Database is busy. The server might be running. Please stop the server first.');
    }
    process.exit(1);
  }
  console.log('Connected to SQLite database for vote clearing');
});

// Check if votes table exists before trying to clear it
function checkTableExists(tableName) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      [tableName],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(!!row);
        }
      }
    );
  });
}

async function clearVotes() {
  try {
    console.log('Checking if votes table exists...');

    const votesTableExists = await checkTableExists('votes');

    if (!votesTableExists) {
      console.log('Votes table does not exist. Nothing to clear.');
      db.close();
      return;
    }

    console.log('Clearing all votes from database...');

    db.run('DELETE FROM votes', [], function(err) {
      if (err) {
        console.error('Error clearing votes:', err);
        process.exit(1);
      } else {
        console.log(`Successfully cleared ${this.changes} votes from database`);

        db.close((closeErr) => {
          if (closeErr) {
            console.error('Error closing database:', closeErr);
            process.exit(1);
          } else {
            console.log('Database closed successfully');
            process.exit(0);
          }
        });
      }
    });

  } catch (error) {
    console.error('Error in clearVotes:', error);
    db.close();
    process.exit(1);
  }
}

clearVotes();