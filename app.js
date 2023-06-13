const express = require("express");
const path = require("path");
// const datefns = require("date-fns");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;
const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};
initializeDBAndServer();

app.post("/register/", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(request.body.password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const createUserQuery = `
      INSERT INTO 
        user (username, name, password, gender) 
      VALUES 
        (
          '${username}', 
          '${name}',
          '${hashedPassword}', 
          '${gender}'
        )`;
      const dbResponse = await db.run(createUserQuery);
      const newUserId = dbResponse.lastID;
      response.send(`User created successfully`);
    }
  } else {
    response.status (400);
    response.send("User already exists");
  }
});

app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  try {
    const { username } = request;
    const getTweetsQuery = `
    SELECT
    (
       SELECT username
       FROM user
       WHERE user_id = tweet.user_id
   ) as username,tweet.tweet,tweet.date_time  FROM (user INNER JOIN follower ON user.user_id=follower.follower_user_id) as T
    INNER JOIN tweet
ON T.following_user_id = tweet.user_id where T.username='${username}' ORDER BY Tweet.date_time DESC
LIMIT 4;
    `;
    let TweetsArray = await db.all(getTweetsQuery);
    TweetsArray = TweetsArray.map((tweet) => ({
      username: tweet.username,
      tweet: tweet.tweet,
      dateTime: tweet.date_time,
    }));
    response.send(TweetsArray);
  } catch (error) {
    console.error("Error retrieving tweets:", error);
    response.status(500).send("Error retrieving tweets");
  }
});

app.get("/user/following", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetsQuery = `
   SELECT
    (
       SELECT username
       FROM user
       WHERE user_id = follower.following_user_id
   ) as name  FROM (user INNER JOIN follower ON user.user_id=follower.follower_user_id) as T
     where T.username='${username}' 

    `;
  const TweetsArray = await db.all(getTweetsQuery);
  response.send(TweetsArray);
});

app.get("/user/followers", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetsQuery = `
   SELECT
    (
       SELECT username
       FROM user
       WHERE user_id = follower.follower_user_id
   ) as name  FROM (user INNER JOIN follower ON user.user_id=follower.following_user_id) as T
     where T.username='${username}' 

    `;
  const TweetsArray = await db.all(getTweetsQuery);
  response.send(TweetsArray);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getTweetUserQuery = `
    SELECT user_id from tweet where tweet_id='${tweetId}';
    `;
  const TweetUserId = await db.get(getTweetUserQuery);
  console.log(TweetUserId);
  const getUserFollowersQuery = ` SELECT
  T.following_user_id
     FROM (user INNER JOIN follower ON user.user_id=follower.follower_user_id) as T
     where T.username='${username}' ;

    `;
  const UserFollowersArray = await db.all(getUserFollowersQuery);
  const newArr = UserFollowersArray.map(
    (follower) => follower.following_user_id
  );
  console.log(UserFollowersArray);
  if (!newArr.includes(TweetUserId.user_id)) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getTweetLikesQuery = `SELECT T.tweet,count(like.like_id) as likes,tweet.date_time
     FROM (tweet join like on tweet.tweet_id=like.tweet_id) as T
    where T.tweet_id='${tweetId}'
    `;
    const getTweetRepliesQuery = `SELECT T.tweet,count(T.reply_id) as replies,tweet.date_time
     FROM (tweet join reply on tweet.tweet_id=reply.tweet_id) as T where T.tweet_id='${tweetId}'
    `;
    const LikesArray = await db.get(getTweetLikesQuery);
    const RepliesArray = await db.get(getTweetRepliesQuery);
    //   console.log(LikesArray);
    //   console.log(RepliesArray);
    //   console.log(LikesArray.tweet)
    response.send({
      tweet: LikesArray.tweet,
      likes: LikesArray.likes,
      replies: RepliesArray.replies,
      dateTime: LikesArray.date_time,
    });
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getTweetUserQuery = `
    SELECT user_id from tweet where tweet_id='${tweetId}';
    `;
    const TweetUserId = await db.get(getTweetUserQuery);
    console.log(TweetUserId);
    const getUserFollowersQuery = ` SELECT
  T.following_user_id
     FROM (user INNER JOIN follower ON user.user_id=follower.follower_user_id) as T
     where T.username='${username}' ;

    `;
    const UserFollowersArray = await db.all(getUserFollowersQuery);
    const newArr = UserFollowersArray.map(
      (follower) => follower.following_user_id
    );
    console.log(UserFollowersArray);
    if (!newArr.includes(TweetUserId.user_id)) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getTweetLikesQuery = `SELECT user.username
     FROM (tweet join like on tweet.tweet_id=like.tweet_id) as T join user on user.user_id=like.user_id
    where T.tweet_id='${tweetId}'
    `;
      let LikesArray = await db.all(getTweetLikesQuery);
      LikesArray = LikesArray.map((like) => like.username);
      response.send({
        likes: LikesArray,
      });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getTweetUserQuery = `
    SELECT user_id from tweet where tweet_id='${tweetId}';
    `;
    const TweetUserId = await db.get(getTweetUserQuery);
    console.log(TweetUserId);
    const getUserFollowersQuery = ` SELECT
  T.following_user_id
     FROM (user INNER JOIN follower ON user.user_id=follower.follower_user_id) as T
     where T.username='${username}' ;

    `;
    const UserFollowersArray = await db.all(getUserFollowersQuery);
    const newArr = UserFollowersArray.map(
      (follower) => follower.following_user_id
    );
    console.log(UserFollowersArray);
    if (!newArr.includes(TweetUserId.user_id)) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getTweetRepliesQuery = `SELECT user.name,reply.reply
     FROM (tweet join reply on tweet.tweet_id=reply.tweet_id) as T join user on user.user_id=reply.user_id
    where T.tweet_id='${tweetId}'
    `;
      let RepliesArray = await db.all(getTweetRepliesQuery);
      console.log(RepliesArray);
      RepliesArray = RepliesArray.map((reply1) => ({
        name: reply1.name,
        reply: reply1.reply,
      }));
      response.send({
        replies: RepliesArray,
      });
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  //   console.log(username);
  getUserTweetLikesQuery = `
    SELECT T.tweet,count(like.like_id) as likes,tweet.date_time
     FROM (tweet join user on tweet.user_id=user.user_id) as T join like on T.tweet_id=like.tweet_id
    where T.username='${username}';
    `;
  getUserTweetRepliesQuery = `
    SELECT T.tweet,count(reply.reply_id) as replies,tweet.date_time
     FROM (tweet join user on tweet.user_id=user.user_id) as T join reply on T.tweet_id=reply.tweet_id
    where T.username='${username}';
    `;
  const UserTweetLikesArray = await db.all(getUserTweetLikesQuery);
  const UserTweetRepliesArray = await db.all(getUserTweetRepliesQuery);
  responseArray = UserTweetLikesArray.map((tweetlikes) => ({
    tweet: tweetlikes.tweet,
    likes: tweetlikes.likes,
    dateTime: tweetlikes.date_time,
  }));
  responseArray2 = UserTweetRepliesArray.map((tweetreplies) => ({
    replies: tweetreplies.replies,
  }));
  const combinedArray = responseArray.map((tweet) => {
    const matchingReply = responseArray2.find(
      (reply) => reply.tweet === tweet.tweet
    );

    return {
      tweet: tweet.tweet,
      likes: tweet.likes,
      replies: matchingReply ? matchingReply.replies : 0,
      dateTime: tweet.dateTime,
    };
  });
  response.send(combinedArray);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  console.log(username);
  const getUserId = `
 SELECT user_id from user where username='${username}';
 `;
  let userId = await db.get(getUserId);
  console.log(userId);
  userId = userId.user_id;
  const TweetQuery = `
 INSERT INTO tweet (tweet,user_id) values 
(
   ' ${tweet}','${userId}'
) ;`;
  await db.run(TweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const getTweetUserQuery = `
    SELECT user_id from tweet where tweet_id='${tweetId}';
    `;
    let TweetUserId = await db.get(getTweetUserQuery);
    TweetUserId = TweetUserId.user_id;
    console.log(TweetUserId);
    const getCurrentUserQuery = ` SELECT
  user_id from user where username='${username}' ;

    `;
    let currentUserId = await db.get(getCurrentUserQuery);
    currentUserId = currentUserId.user_id;

    console.log(currentUserId);
    if (currentUserId !== TweetUserId) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteUserTweet = `
    DELETE FROM
  tweet
WHERE
  tweet_id = '${tweetId}';
    `;
      await db.run(deleteUserTweet);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
