import pickle

hypo_dict = {
    'ATTTCCGG' : ['ETS1', 'AAA'],
    'CGCCCACG' : ['EGR1', 'BBB'],
    'ACGATTTT' : ['HOXB13']
}

with open('uploads/hypo_dict.pkl', 'wb') as file:
    pickle.dump(hypo_dict, file)