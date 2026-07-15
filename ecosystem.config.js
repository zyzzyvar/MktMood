module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "mktmood",
      script: "server.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      time: true,
      max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || "450M",
      exp_backoff_restart_delay: 5000,
      restart_delay: 2000,
      kill_timeout: 10000,
      listen_timeout: 10000,
      wait_ready: false,
      node_args: "--unhandled-rejections=warn",
      env: {
        NODE_ENV: "production",
        HOST: process.env.HOST || "0.0.0.0",
        PORT: process.env.PORT || "3000"
      }
    }
  ]
};
