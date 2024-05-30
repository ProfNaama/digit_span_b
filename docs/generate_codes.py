
import random
random.seed(74674870)

code_len = 10
codes_count = 320

def generate_codes(codes_count=320):
    d = list(map(str, range(10))) + [chr(ord("a")+i) for i in range(26)]
    return ["".join([d[random.randint(0, len(d)-1)]  for i in range(code_len)]) for i in range(codes_count)]
    

def generate_csv_format(codes):
    liens = ["{}".format(c) for c in codes]
    print("\n".join(liens))

# prapare for PostgreSQL
def generate_postgresql_format(codes):
    print ("INSERT INTO digit_span_b_codes (code) VALUES")
    print(",\n".join(["(\'" + c + "\')" for c in codes]))
    print (";")
    
codes = generate_codes(codes_count * 2)
codes = codes[codes_count:]
print("================")
generate_csv_format(codes)
print("================")
generate_postgresql_format(codes)
print("================")
