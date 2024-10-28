# Use an official Node.js runtime as the base image
FROM node:21.7.1

# Install fish shell
RUN apt-get update && apt-get install -y fish

# Set the working directory in the container
WORKDIR /usr/src/app

# Clone the fish-lsp repository
RUN git clone https://github.com/ndonfris/fish-lsp .

# Install dependencies
RUN yarn install

# Expose the port the app runs on
EXPOSE 3000

# Create a startup script
RUN echo '#!/bin/sh\n\
fish-lsp start --host 0.0.0.0 --port 3000' > /usr/src/app/start.sh && \
chmod +x /usr/src/app/start.sh

# Run the app when the container launches
CMD ["/usr/src/app/start.sh"]