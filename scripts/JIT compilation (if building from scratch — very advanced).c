// jit.c - minimal JIT compiler for a stack-based arithmetic bytecode (x86-64, Linux)
// Build: gcc -o jit jit.c
// Run:   ./jit

#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>

typedef enum { OP_PUSH, OP_ADD, OP_SUB, OP_MUL, OP_RET } OpCode;

typedef struct {
    OpCode op;
    int64_t val;
} Instr;

typedef struct {
    uint8_t *buf;
    size_t len;
    size_t cap;
} CodeBuf;

static void cb_init(CodeBuf *cb) {
    cb->cap = 256;
    cb->len = 0;
    cb->buf = malloc(cb->cap);
}

static void cb_emit(CodeBuf *cb, const uint8_t *bytes, size_t n) {
    if (cb->len + n > cb->cap) {
        cb->cap = (cb->len + n) * 2;
        cb->buf = realloc(cb->buf, cb->cap);
    }
    memcpy(cb->buf + cb->len, bytes, n);
    cb->len += n;
}

static void cb_emit_push_imm32(CodeBuf *cb, int32_t imm) {
    uint8_t bytes[5];
    bytes[0] = 0x68; // push imm32 (sign-extended to 64-bit)
    memcpy(bytes + 1, &imm, 4);
    cb_emit(cb, bytes, 5);
}

static void jit_compile(CodeBuf *cb, Instr *prog, size_t n) {
    static const uint8_t pop_rax[]  = {0x58};
    static const uint8_t pop_rbx[]  = {0x5B};
    static const uint8_t add_rax_rbx[] = {0x48, 0x01, 0xD8};
    static const uint8_t sub_rax_rbx[] = {0x48, 0x29, 0xD8};
    static const uint8_t imul_rax_rbx[] = {0x48, 0x0F, 0xAF, 0xC3};
    static const uint8_t push_rax[] = {0x50};
    static const uint8_t ret_[]     = {0xC3};

    for (size_t i = 0; i < n; i++) {
        switch (prog[i].op) {
            case OP_PUSH:
                cb_emit_push_imm32(cb, (int32_t)prog[i].val);
                break;
            case OP_ADD:
                cb_emit(cb, pop_rbx, sizeof(pop_rbx));
                cb_emit(cb, pop_rax, sizeof(pop_rax));
                cb_emit(cb, add_rax_rbx, sizeof(add_rax_rbx));
                cb_emit(cb, push_rax, sizeof(push_rax));
                break;
            case OP_SUB:
                cb_emit(cb, pop_rbx, sizeof(pop_rbx));
                cb_emit(cb, pop_rax, sizeof(pop_rax));
                cb_emit(cb, sub_rax_rbx, sizeof(sub_rax_rbx));
                cb_emit(cb, push_rax, sizeof(push_rax));
                break;
            case OP_MUL:
                cb_emit(cb, pop_rbx, sizeof(pop_rbx));
                cb_emit(cb, pop_rax, sizeof(pop_rax));
                cb_emit(cb, imul_rax_rbx, sizeof(imul_rax_rbx));
                cb_emit(cb, push_rax, sizeof(push_rax));
                break;
            case OP_RET:
                cb_emit(cb, pop_rax, sizeof(pop_rax));
                cb_emit(cb, ret_, sizeof(ret_));
                break;
        }
    }
}

typedef int64_t (*JitFunc)(void);

int main(void) {
    // Program: (3 + 4) * 2 - 5  => expected result 9
    Instr prog[] = {
        { OP_PUSH, 3 },
        { OP_PUSH, 4 },
        { OP_ADD,  0 },
        { OP_PUSH, 2 },
        { OP_MUL,  0 },
        { OP_PUSH, 5 },
        { OP_SUB,  0 },
        { OP_RET,  0 },
    };
    size_t prog_len = sizeof(prog) / sizeof(prog[0]);

    CodeBuf cb;
    cb_init(&cb);
    jit_compile(&cb, prog, prog_len);

    void *mem = mmap(NULL, cb.len, PROT_READ | PROT_WRITE | PROT_EXEC,
                      MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (mem == MAP_FAILED) {
        perror("mmap");
        return 1;
    }
    memcpy(mem, cb.buf, cb.len);

    JitFunc fn = (JitFunc)mem;
    int64_t result = fn();

    printf("JIT result: %ld\n", result);

    munmap(mem, cb.len);
    free(cb.buf);
    return 0;
}
