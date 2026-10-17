# SnapShare Scaling Plan

SnapShare is a photo-sharing app where users upload photos and scroll a feed of photos from people they follow.

## 1. Assumptions

**Daily active users (DAU) = 10,000,000 registered users x 10% = 1,000,000 users per day.**

| Assumption | Value |
|---|---|
| Registered users | 10,000,000 |
| Daily active users (10%) | 1,000,000 |
| Uploads per active user per day | 1 photo |
| Feed pages viewed per active user per day | 50 |
| Average original photo size | 2 MB |
| Thumbnail size | 50 KB (one thumbnail per photo) |
| Seconds per day | 86,400 |
| Peak traffic vs. average (my assumption) | 5x |
| Photos shown per feed page (my assumption) | 10 thumbnails |
| Metadata per photo (id, owner, URL, caption, timestamp) | about 1 KB |
| Traffic spread | Evenly over the day for the average; the 5x factor covers evening peaks |

## 2. Estimates

### Uploads per second
- Uploads per day = 1,000,000 users x 1 photo = **1,000,000 photos/day**
- Average = 1,000,000 / 86,400 = **about 12 uploads/second**
- Peak (5x) = **about 60 uploads/second**
- Upload bandwidth: 12 x 2 MB = about 24 MB/s average, about 120 MB/s at peak

### Feed views per second
- Feed views per day = 1,000,000 x 50 = **50,000,000 feed pages/day**
- Average = 50,000,000 / 86,400 = **about 580 feed views/second**
- Peak (5x) = **about 2,900 feed views/second**
- Thumbnail requests: 580 x 10 = about 5,800/second average (about 29,000 at peak), roughly 290 MB/s (about 2.3 Gbps) of thumbnail traffic on average, which is why a CDN is required

### Storage per year
- Originals per day: 1,000,000 x 2 MB = 2 TB
- Thumbnails per day: 1,000,000 x 50 KB = 50 GB
- Total per day = about 2.05 TB
- Originals per year: 2 TB x 365 = **730 TB**
- Thumbnails per year: 50 GB x 365 = **about 18 TB**
- Metadata per year: 1 KB x 365,000,000 = **about 365 GB** (tiny compared to the photos)
- **Total: about 750 TB per year (about 0.75 PB)**

### Read-heavy or write-heavy?
**SnapShare is read-heavy.** There are about 580 feed views per second against about 12 uploads per second, a ratio of roughly **50 reads for every 1 write**. And each feed view loads about 10 thumbnails, so the real ratio of image reads to image writes is far higher. This is why the design focuses on caching, a CDN and read replicas. The write side is smaller in request count, but it is large in bytes (about 2 TB/day), so uploads go straight to object storage and heavy work is done asynchronously.

### What read-heavy means for the design
- **Optimise the read path first.** Put a CDN in front of images and a cache in front of feed data, so most requests never reach the database.
- **Scale reads separately from writes.** One primary database takes writes, and one or more read replicas take the feed queries. We can add replicas as reads grow.
- **Keep app servers stateless** so we can add more behind the load balancer as feed traffic grows.
- **Make writes cheap and asynchronous.** The request count for uploads is small, so we keep it that way: the big file goes straight to object storage and slow work (thumbnails) runs on a queue.
- **Accept slightly stale reads** (cache and replica lag) in return for speed, because reading is the common case.

### Why photos should not be stored inside the database
- **Size:** about 750 TB per year of binary files would make the database enormous, slow to back up, slow to restore and very expensive to run on database-grade disks.
- **Performance:** big blobs fill the database's memory and I/O, pushing out the small, hot rows (users, follows, photo metadata) that feeds actually need. Every image read would also use a database connection.
- **Scaling and cost:** databases are hard to scale for writes, while object storage scales almost without limit at a much lower price per GB, with built-in durability and copies across locations.
- **Delivery:** a database cannot serve files to a CDN as easily as object storage can, and browsers can fetch object-storage URLs directly.
- **Where they go instead:** the **object storage** (originals and thumbnails in separate folders or buckets). The database stores only the photo's **metadata and URL/key** (owner, caption, timestamp, status, storage path), which is about 1 KB per photo.

## 3. Architecture Diagram

```
                          +----------------------+
                          |        Users         |
                          |  (mobile app / web)  |
                          +----------+-----------+
                                     |
              +----------------------+----------------------+
              | photos/thumbnails (GET)                     | API calls (feed, upload request)
              v                                             v
     +-----------------+                          +-------------------+
     |       CDN       |                          |   Load Balancer   |
     | (edge caches)   |                          +---------+---------+
     +--------+--------+                                    |
              | cache miss                     +------------+------------+
              v                                |            |            |
     +-----------------+                       v            v            v
     |  Object Storage |                  +--------+   +--------+   +--------+
     | originals/      |                  | App    |   | App    |   | App    |
     | thumbnails/     |                  | Server |   | Server |   | Server |
     +--------+--------+                  +---+----+   +---+----+   +---+----+
              ^   ^                           |            |            |
              |   |                           +-----+------+------+-----+
              |   |                                 |             |
              |   | (1) upload via                  v             v
              |   |     pre-signed URL         +---------+   +-----------+
              |   +----------------------------+  Cache  |   |   Queue   |
              |                                | (Redis) |   |           |
              |                                +----+----+   +-----+-----+
              |                                     | miss         |
              |                                     v              v
              |                          +--------------------+  +-----------+
              |                          |  Database          |  | Thumbnail |
              |                          |  Primary (writes)  |  | Worker(s) |
              |                          +---------+----------+  +-----+-----+
              |                                    | replication       |
              |                                    v                   |
              |                          +--------------------+        |
              |                          |  Read Replica      |        |
              |                          |  (feed reads)      |        |
              |                          +--------------------+        |
              |                                                        |
              +--------------- thumbnail written back -----------------+
                (worker reads original, writes 50 KB thumbnail)
```

Reads of photos go **User -> CDN -> Object Storage** (only on a cache miss). Reads of feed data go **User -> Load Balancer -> App Server -> Cache -> Read Replica**. Writes of metadata go to the **Database primary**, and photo files go straight to **Object Storage**.

## 4. What Each Component Solves

- **CDN:** It serves photos and thumbnails from edge servers near the user, which solves slow image loading and keeps most of the roughly 2.3 Gbps of image traffic away from our own servers.
- **Load Balancer:** It spreads incoming requests across many app servers, which solves the single-server bottleneck and lets us survive a server failure.
- **App Servers:** They run the business logic (auth, feed building, upload handling), and because they are stateless we can solve growing traffic by simply adding more of them.
- **Cache (e.g. Redis):** It keeps hot data such as recent feeds and photo metadata in memory, which solves repeated database reads for the same data and cuts feed latency.
- **Database (primary):** It stores users, follows, and photo metadata reliably, which solves the need for durable, consistent structured data and a single place to accept writes.
- **Read Replica:** It is a copy of the primary that serves read queries, which solves the problem of 580+ feed reads per second overloading the database that also handles writes.
- **Object Storage:** It stores the large photo files (about 750 TB per year) cheaply and durably, which solves the problem that a database or app-server disk cannot hold that much binary data.
- **Queue:** It holds "make a thumbnail" jobs until a worker is free, which solves the problem of upload spikes slowing down users or crashing the processing step.
- **Thumbnail Worker:** It takes jobs from the queue and creates the 50 KB thumbnail from the 2 MB original, which solves slow feed loading (loading originals would be 40x more data per photo) without making the uploader wait.

## 5. Step-by-Step Flow: Uploading a Photo

1. The user picks a photo in the app and taps **Upload**.
2. The request goes through the **load balancer** to an **app server**, which checks that the user is logged in and that the file type and size are allowed.
3. The app server creates a photo record in the **database primary** with status `pending` and returns a **pre-signed upload URL** for **object storage**.
4. The client uploads the 2 MB original **directly to object storage** using that URL, so the big file never passes through the app servers.
5. When the upload finishes, object storage (or the client) notifies an app server, which puts a **"create thumbnail" job** (photo id + file location) on the **queue**.
6. The app server immediately tells the user "upload successful". The user does not wait for the thumbnail.
7. A **thumbnail worker** picks up the job, reads the original from object storage, creates a 50 KB thumbnail, and writes it back to object storage.
8. The worker updates the photo record in the database to status `ready` and thumbnail URL set.
9. The **cache** entries for the followers' feeds are invalidated (or updated), so the new photo appears the next time they load their feed.
10. Followers load the feed: metadata comes from the cache or read replica, and the thumbnail is fetched through the **CDN**. The first request is a CDN miss that pulls from object storage, and later requests are served from the edge.

If a worker fails, the job stays on the queue and is retried, so no thumbnail is lost.

## 6. Trade-offs

1. **Cache speed vs. freshness (consistency).** Caching feeds makes them fast and protects the database, but a follower might not see a brand-new photo until the cache entry expires or is invalidated. We accept a delay of a few seconds because a feed is not a bank balance, and this is much cheaper than querying the database for every view.
2. **Read replica vs. replication lag.** A replica lets us scale feed reads, but it is slightly behind the primary, so a user could upload a photo and not see it on their own feed immediately. We reduce this by reading the user's own recent uploads from the primary (or the cache) and using the replica for everyone else, at the cost of extra complexity.
3. **Asynchronous thumbnails vs. instant availability.** The queue and worker keep uploads fast and absorb spikes, but there is a short window where the photo exists with no thumbnail. We handle it by showing a placeholder or hiding the photo from followers until its status is `ready`, which trades immediacy for reliability.
4. **CDN cost vs. speed.** The CDN makes image loading fast and protects our servers, but we pay for bandwidth and cached copies, and cached images can be stale if we change or delete a photo (needs invalidation). With about 2.3 Gbps of thumbnail traffic, the CDN is still cheaper than scaling our own servers.
5. **Object storage vs. database for files.** Object storage is cheap and scales to petabytes, but we lose transactions and joins, so we must keep the database record and the file consistent ourselves (the `pending`/`ready` status handles this).

