FROM node:20-alpine

WORKDIR /app

# Copy package configuration
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

EXPOSE 5173

# CMD to start the dev server
CMD ["npm", "run", "dev"]
