/* Sockets as the SDK uses them: getaddrinfo + a UDP socket that sendto()s. Everything else is the libc's declaration only.
 * The calls are renamed to dbnet_* (net_shim.c) so that no real (emscripten) socket is ever opened: UDP goes to bench-side peers. */
#ifndef DB_LWIP_SOCKETS_H
#define DB_LWIP_SOCKETS_H
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#ifdef __cplusplus
extern "C" {
#endif
int dbnet_getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res);
void dbnet_freeaddrinfo(struct addrinfo *ai);
int dbnet_socket(int domain, int type, int protocol);
ssize_t dbnet_sendto(int s, const void *data, size_t size, int flags, const struct sockaddr *to, socklen_t tolen);
int dbnet_close(int s);
#ifdef __cplusplus
}
#endif
#define getaddrinfo dbnet_getaddrinfo
#define freeaddrinfo dbnet_freeaddrinfo
#define socket dbnet_socket
#define sendto dbnet_sendto
#define close dbnet_close
#endif
