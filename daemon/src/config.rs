use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(author, version, about, long_about = None)]
pub struct Config {
    #[arg(long, default_value = "0.0.0.0:8080")]
    pub bind: SocketAddr,

    #[arg(long, default_value = ".")]
    pub root: PathBuf,

    #[arg(long)]
    pub token: Option<String>,
}
