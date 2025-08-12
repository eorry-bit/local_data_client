use anyhow::{Context, Result};
use duckdb::Connection;
use std::path::PathBuf;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "import_ts_kv")]
#[command(about = "DuckDB ts_kv table incremental import tool")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Import data from CSV file to ts_kv table
    Import {
        /// Path to the CSV file to import
        #[arg(short, long)]
        csv_file: PathBuf,
        
        /// Path to the DuckDB database file
        #[arg(short, long, default_value = "data.db")]
        database: String,
        
        /// Skip creating temporary table (assume it already exists)
        #[arg(long)]
        skip_temp_table: bool,
        
        /// Custom temporary table name
        #[arg(long, default_value = "temp_ts_kv")]
        temp_table: String,
    },
}

fn import_ts_kv(
    csv_file: &PathBuf,
    database: &str,
    skip_temp_table: bool,
    temp_table: &str,
) -> Result<()> {
    // Check if CSV file exists
    if !csv_file.exists() {
        anyhow::bail!("CSV file does not exist: {:?}", csv_file);
    }
    
    println!("Connecting to database: {}", database);
    let conn = Connection::open(database)
        .context("Failed to open database connection")?;
    
    // Check if ts_kv table exists
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM information_schema.tables WHERE table_name = 'ts_kv'",
            [],
            |row| row.get(0),
        )
        .context("Failed to check if ts_kv table exists")?;
    
    if !table_exists {
        println!("Creating ts_kv table...");
        conn.execute(
            "CREATE TABLE ts_kv (
                entity_id VARCHAR NOT NULL,
                key INTEGER NOT NULL,
                ts BIGINT NOT NULL,
                bool_v BOOLEAN,
                str_v VARCHAR,
                long_v BIGINT,
                dbl_v DOUBLE,
                PRIMARY KEY (entity_id, key, ts)
            )",
            [],
        )
        .context("Failed to create ts_kv table")?;
    }
    
    if !skip_temp_table {
        // Drop temporary table if exists
        conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_table), [])
            .context("Failed to drop existing temporary table")?;
        
        // Create temporary table with same structure as ts_kv
        println!("Creating temporary table: {}", temp_table);
        conn.execute(
            &format!(
                "CREATE TEMP TABLE {} AS SELECT * FROM ts_kv WHERE 1=0",
                temp_table
            ),
            [],
        )
        .context("Failed to create temporary table")?;
    }
    
    // Import data from CSV to temporary table
    println!("Importing data from CSV: {:?}", csv_file);
    let csv_path = csv_file.to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid CSV file path"))?;
    
    let import_query = format!(
        "COPY {} FROM '{}' (HEADER TRUE, DELIMITER ',')",
        temp_table,
        csv_path.replace('\'', "''")
    );
    
    let imported_count = conn.execute(&import_query, [])
        .context("Failed to import CSV data to temporary table")?;
    
    println!("Imported {} rows to temporary table", imported_count);
    
    // Get count of rows in temporary table for verification
    let temp_count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {}", temp_table),
            [],
            |row| row.get(0),
        )
        .context("Failed to count rows in temporary table")?;
    
    println!("Temporary table contains {} rows", temp_count);
    
    // Perform UPSERT operation
    println!("Performing UPSERT operation...");
    
    // First, get the count of existing rows that will be updated
    let update_count: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM {} t 
                 WHERE EXISTS (
                     SELECT 1 FROM ts_kv k 
                     WHERE k.entity_id = t.entity_id 
                     AND k.key = t.key 
                     AND k.ts = t.ts
                 )",
                temp_table
            ),
            [],
            |row| row.get(0),
        )
        .context("Failed to count rows to update")?;
    
    let insert_count = temp_count - update_count;
    
    println!("Will update {} existing rows and insert {} new rows", update_count, insert_count);
    
    // Perform the UPSERT using INSERT ... ON CONFLICT
    let upsert_query = format!(
        "INSERT INTO ts_kv 
         SELECT * FROM {}
         ON CONFLICT (entity_id, key, ts) 
         DO UPDATE SET
             bool_v = EXCLUDED.bool_v,
             str_v = EXCLUDED.str_v,
             long_v = EXCLUDED.long_v,
             dbl_v = EXCLUDED.dbl_v",
        temp_table
    );
    
    let affected_rows = conn.execute(&upsert_query, [])
        .context("Failed to perform UPSERT operation")?;
    
    println!("UPSERT operation completed. Affected rows: {}", affected_rows);
    
    // Get final count in ts_kv table
    let final_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ts_kv", [], |row| row.get(0))
        .context("Failed to count final rows in ts_kv")?;
    
    println!("Final row count in ts_kv table: {}", final_count);
    
    // Clean up temporary table
    if !skip_temp_table {
        conn.execute(&format!("DROP TABLE IF EXISTS {}", temp_table), [])
            .context("Failed to drop temporary table")?;
        println!("Temporary table cleaned up");
    }
    
    println!("Import completed successfully!");
    
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    
    match cli.command {
        Commands::Import {
            csv_file,
            database,
            skip_temp_table,
            temp_table,
        } => {
            import_ts_kv(&csv_file, &database, skip_temp_table, &temp_table)?;
        }
    }
    
    Ok(())
}