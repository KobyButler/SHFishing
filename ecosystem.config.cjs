module.exports = {
  apps: [
    {
      name: 'sh-fishing',
      script: 'src/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
    },
  ],
};
