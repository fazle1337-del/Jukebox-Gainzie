const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DB_PATH || './database/jukebox.db';

console.log('Clearing all votes from database...');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run('DELETE FROM votes', [], function(err) {
    if (err) {
      console.error('Error clearing votes:', err);
      process.exit(1);
    }

    console.log(`✅ Cleared ${this.changes} votes from database`);
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      }
      console.log('Database connection closed');
    });
  });
});